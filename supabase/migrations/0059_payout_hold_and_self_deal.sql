-- New drivers wait 48 hours after completion before a transfer can become ready.
-- Drivers with five or more completed jobs keep the existing delay.
-- A person cannot see or take their own request as a driver.
-- Local until the owner applies it. Customer capture timing is unchanged.

create or replace function public.driver_completed_jobs(target_driver uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.jobs
  where assigned_driver_id = target_driver
    and status = 'completed';
$$;

revoke all on function public.driver_completed_jobs(uuid) from public, anon, authenticated, service_role;

create or replace function public.my_payout_wait()
returns interval
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  delay_hours integer;
  delay_seconds integer;
begin
  if auth.uid() is null then
    return null;
  end if;
  if public.driver_completed_jobs(auth.uid()) < 5 then
    return interval '48 hours';
  end if;
  select payout_delay_hours, payout_delay_seconds
  into delay_hours, delay_seconds
  from public.platform_settings
  where id = 1;
  if delay_seconds is not null then
    return make_interval(secs => delay_seconds);
  end if;
  return make_interval(hours => coalesce(delay_hours, 24));
end;
$$;

revoke all on function public.my_payout_wait() from public, anon, service_role;
grant execute on function public.my_payout_wait() to authenticated;

create or replace function public.refresh_ledger_readiness()
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  delay_hours integer;
  delay_seconds integer;
begin
  select payout_delay_hours, payout_delay_seconds
  into delay_hours, delay_seconds
  from public.platform_settings
  where id = 1;

  update public.ledger_entries as entry
  set status = case
      when exists (
        select 1 from public.job_disputes
        where job_id = entry.job_id and payout_hold
      ) then 'held'
      when exists (
        select 1 from public.card_disputes
        where job_id = entry.job_id and outcome is null
      ) then 'held'
      when not exists (
        select 1 from public.driver_connect_accounts
        where driver_id = entry.driver_id and payouts_enabled
      ) then 'held_until_onboarding'
      when entry.available_on is not null
        and entry.available_on <= now()
        and entry.amount_cents > 0
        and exists (
          select 1 from public.jobs
          where jobs.id = entry.job_id
            and jobs.updated_at <= now() - case
              when public.driver_completed_jobs(entry.driver_id) < 5 then interval '48 hours'
              when delay_seconds is not null then make_interval(secs => delay_seconds)
              else make_interval(hours => delay_hours)
            end
            and (
              jobs.status = 'completed'
              or (jobs.status = 'cancelled' and jobs.payment_status = 'captured')
            )
        ) then 'ready'
      else 'pending'
    end,
    hold_reason = case
      when exists (
        select 1 from public.job_disputes
        where job_id = entry.job_id and payout_hold
      ) then 'A problem report is open'
      when exists (
        select 1 from public.card_disputes
        where job_id = entry.job_id and outcome is null
      ) then 'A card dispute is open'
      when not exists (
        select 1 from public.driver_connect_accounts
        where driver_id = entry.driver_id and payouts_enabled
      ) then 'Finish payout setup before a transfer can be sent'
      when entry.available_on is null then 'Waiting for the card payment to become available'
      when public.driver_completed_jobs(entry.driver_id) < 5
        and exists (
          select 1 from public.jobs
          where jobs.id = entry.job_id
            and jobs.updated_at > now() - interval '48 hours'
        ) then 'Earnings stay held for 48 hours after a new driver finishes a job'
      else null
    end,
    updated_at = now()
  where entry.status in ('pending', 'held', 'held_until_onboarding', 'ready')
    and entry.stripe_transfer_id is null
    and entry.external_method is null;
end;
$function$;

create or replace function public.driver_is_eligible_for_job(target_job uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  profile_row public.profiles%rowtype;
  driver_row public.drivers%rowtype;
  job_row public.jobs%rowtype;
begin
  if uid is null then
    return false;
  end if;
  select * into profile_row from public.profiles where id = uid;
  if not found or profile_row.blocked then
    return false;
  end if;
  select * into driver_row from public.drivers where profile_id = uid;
  if not found or driver_row.status not in ('active', 'approved_new') then
    return false;
  end if;
  select * into job_row from public.jobs where id = target_job;
  if not found or job_row.status <> 'open' then
    return false;
  end if;
  if job_row.customer_id = uid then
    return false;
  end if;
  if job_row.paused_at is not null then
    return false;
  end if;
  if job_row.required_vehicle is not null and not exists (
    select 1 from public.vehicles
    where driver_id = uid and type = job_row.required_vehicle
  ) then
    return false;
  end if;
  if exists (
    select 1 from public.customer_driver_blocks
    where customer_id = job_row.customer_id and driver_id = uid
  ) then
    return false;
  end if;
  if public.waves_enabled() and not public.job_released_to_driver(uid, job_row) then
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.driver_browse_jobs()
returns table (
  id uuid,
  service public.job_service,
  pieces integer,
  size public.item_size,
  pickup_area text,
  dropoff_area text,
  distance_miles numeric,
  stairs_pickup integer,
  stairs_dropoff integer,
  elevator boolean,
  help_loading boolean,
  preferred_date text,
  time_window public.time_window,
  pricing_method public.pricing_method,
  offer_cents integer,
  budget_min_cents integer,
  budget_max_cents integer,
  driver_pay_cents integer,
  quote_expires_at timestamptz,
  junk_load_size public.junk_load_size,
  service_level public.service_level,
  required_vehicle public.vehicle_type,
  created_at timestamptz,
  miles_from_you numeric,
  date_group text,
  matched boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  profile_row public.profiles%rowtype;
  driver_row public.drivers%rowtype;
begin
  if uid is null then
    return;
  end if;
  select * into profile_row from public.profiles where profiles.id = uid;
  if not found or profile_row.blocked then
    return;
  end if;
  select * into driver_row from public.drivers where drivers.profile_id = uid;
  if not found or driver_row.status = 'removed' then
    return;
  end if;
  return query
  select
    j.id,
    j.service,
    j.pieces,
    j.size,
    j.pickup_area,
    j.dropoff_area,
    j.distance_miles,
    j.stairs_pickup,
    j.stairs_dropoff,
    j.elevator,
    j.help_loading,
    j.preferred_date,
    j.time_window,
    j.pricing_method,
    case when j.pricing_method = 'fixed' then j.offer_cents else null end,
    case when j.pricing_method = 'range' then j.budget_min_cents else null end,
    case when j.pricing_method = 'range' then j.budget_max_cents else null end,
    case when j.pricing_method = 'quote' then j.driver_pay_cents else null end,
    case when j.pricing_method = 'quote' then j.quote_expires_at else null end,
    j.junk_load_size,
    j.service_level,
    j.required_vehicle,
    j.created_at,
    public.driver_home_miles(uid, j.pickup_area),
    public.feed_date_group(j.preferred_date),
    public.coverage_matches(uid, j.pickup_area)
  from public.jobs j
  where j.status = 'open'
    and j.paused_at is null
    and j.customer_id is distinct from uid
    and (
      not public.waves_enabled()
      or public.job_released_to_driver(uid, j)
    )
    and not exists (
      select 1 from public.customer_driver_blocks
      where customer_id = j.customer_id and driver_id = uid
    );
end;
$$;
