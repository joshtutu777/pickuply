-- Forward-only. Do not apply 0123. It is an older Online check and would replace this function.
-- This file does not change existing request rows. The 21-request correction is a separate reviewed script.

create or replace function public.set_driver_online(go_online boolean)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  driver_row public.drivers%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into driver_row from public.drivers where profile_id = uid;
  if not found then
    raise exception 'driver profile not found';
  end if;

  if go_online then
    if public.account_is_suspended(uid) then
      raise exception 'Your Pickuply driver account is restricted. You cannot go Online while this restriction is active.';
    end if;
    if driver_row.status not in ('active', 'approved_new') then
      raise exception 'Finish these steps. You can go Online after Pickuply approves you.';
    end if;
    if driver_row.terms_version is distinct from 'driver-terms-v2' then
      raise exception 'Accept the Driver Terms to go Online.';
    end if;
  end if;

  perform set_config('pickuply.driver_online', 'yes', true);
  update public.drivers
  set
    is_online = go_online,
    first_online_at = case
      when go_online then coalesce(first_online_at, now())
      else first_online_at
    end
  where profile_id = uid;
end;
$function$;

create or replace function public.assert_saved_schedule(offer_row public.job_offers, job_row public.jobs)
returns void
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  window_row public.job_pickup_windows%rowtype;
  accept_lead integer := public.pickup_accept_lead_minutes();
begin
  if job_row.pickup_availability is null then
    return;
  end if;

  if job_row.pickup_availability in ('anytime', 'asap')
    and offer_row.proposed_pickup_start is null
    and offer_row.proposed_pickup_end is null
    and offer_row.pickup_window_id is null then
    return;
  end if;

  if job_row.scheduled_pickup_start is not null
    and offer_row.proposed_pickup_start is null
    and job_row.scheduled_pickup_start <= now() then
    raise exception 'Your pickup time has passed. Update your pickup time before choosing a driver.';
  end if;

  if job_row.pickup_availability in ('anytime', 'asap') then
    if offer_row.proposed_pickup_start is null
      or offer_row.proposed_pickup_end is not null
      or offer_row.pickup_window_id is not null
      or offer_row.proposed_pickup_start <= now()
      or not public.booking_instant_allowed(offer_row.proposed_pickup_start) then
      raise exception 'That pickup time has passed. Update your pickup time before choosing a driver.';
    end if;
    return;
  end if;

  if offer_row.pickup_window_id is null and offer_row.proposed_pickup_start is null then
    if not exists (
      select 1
      from public.job_pickup_windows
      where job_id = job_row.id
        and ends_at >= now() + make_interval(mins => accept_lead)
    ) then
      raise exception 'Your pickup windows have passed. Update your pickup time before choosing a driver.';
    end if;
    return;
  end if;

  select * into window_row
  from public.job_pickup_windows
  where id = offer_row.pickup_window_id and job_id = job_row.id;
  if not found then
    raise exception 'Your pickup windows have passed. Update your pickup time before choosing a driver.';
  end if;
  if offer_row.proposed_pickup_start is not null then
    if offer_row.proposed_pickup_start < window_row.starts_at
      or offer_row.proposed_pickup_start > window_row.ends_at
      or offer_row.proposed_pickup_start <= now() then
      raise exception 'That pickup time has passed. Update your pickup time before choosing a driver.';
    end if;
  elsif offer_row.proposed_pickup_start is distinct from window_row.starts_at
    or offer_row.proposed_pickup_end is distinct from window_row.ends_at then
    raise exception 'Your pickup windows have passed. Update your pickup time before choosing a driver.';
  end if;
  if window_row.ends_at < now() + make_interval(mins => accept_lead) then
    raise exception 'Your pickup windows have passed. Update your pickup time before choosing a driver.';
  end if;
end;
$function$;

create or replace function public.choose_offer(target_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  offer_row public.job_offers%rowtype;
  job_row public.jobs%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if public.account_is_suspended(uid) then
    raise exception 'Your Pickuply account is restricted. You cannot create or book new pickups while this restriction is active.';
  end if;
  select * into offer_row from public.job_offers where id = target_offer;
  if not found or offer_row.status <> 'active' or offer_row.expires_at <= now() or offer_row.unavailable_at is not null then
    raise exception 'that offer is no longer available';
  end if;
  if public.account_is_suspended(offer_row.driver_id) then
    raise exception 'that offer is no longer available';
  end if;
  select * into job_row from public.jobs where id = offer_row.job_id for update;
  if not found or job_row.status <> 'open' then
    raise exception 'job already taken';
  end if;
  if job_row.customer_id is distinct from uid then
    raise exception 'only the customer can choose an offer on an open job';
  end if;
  select * into offer_row from public.job_offers where id = target_offer for update;
  if not found or offer_row.status <> 'active' or offer_row.expires_at <= now() or offer_row.unavailable_at is not null then
    raise exception 'that offer is no longer available';
  end if;
  perform set_config('pickuply.offer_chosen', 'yes', true);
  update public.job_offers set status = 'chosen' where id = target_offer;
  update public.job_offers
  set status = 'declined'
  where job_id = offer_row.job_id and id <> target_offer and status = 'active';
  perform public.assert_saved_schedule(offer_row, job_row);
  update public.jobs
  set
    status = 'assigned',
    assigned_driver_id = offer_row.driver_id,
    accepted_offer_id = target_offer,
    price_cents = offer_row.customer_total_cents,
    driver_pay_cents = offer_row.driver_amount_cents,
    platform_fee_cents = offer_row.platform_fee_cents,
    service_fee_cents = offer_row.service_fee_cents,
    commission_bps = offer_row.commission_bps,
    payment_status = 'awaiting_payment',
    payment_due_at = public.payment_due_at()
  where id = offer_row.job_id;
  insert into public.job_events (job_id, actor_id, type, data)
  values (
    offer_row.job_id, uid, 'offer_chosen',
    jsonb_build_object('offer_id', target_offer, 'to', 'assigned')
  );
end;
$function$;

create or replace function public.guard_pickup_windows()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if public.is_migration_session()
    or coalesce(current_setting('pickuply.schedule_write', true), '') = 'yes' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception 'customer pickup windows cannot be changed';
end;
$function$;

create or replace function public.guard_window_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  saved integer;
  availability text;
begin
  if public.is_migration_session()
    or coalesce(current_setting('pickuply.schedule_write', true), '') = 'yes' then
    return new;
  end if;
  select pickup_availability into availability
  from public.jobs
  where id = new.id;
  select count(*)::integer into saved
  from public.job_pickup_windows
  where job_id = new.id;
  if availability = 'windows' and saved not between 1 and 3 then
    raise exception 'Add between 1 and 3 pickup windows.';
  end if;
  if availability is distinct from 'windows' and saved > 0 then
    raise exception 'This choice does not use pickup windows.';
  end if;
  return new;
end;
$function$;

create or replace function public.update_open_pickup_timing(target_job uuid, next_availability text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if next_availability not in ('asap', 'anytime') then
    raise exception 'Choose As soon as possible or Anytime.';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from uid or job_row.status <> 'open' then
    raise exception 'This request can no longer be updated.';
  end if;
  perform set_config('pickuply.schedule_write', 'yes', true);
  delete from public.job_pickup_windows where job_id = target_job;
  update public.jobs
  set
    pickup_availability = next_availability,
    pickup_timezone = 'America/New_York',
    preferred_date = next_availability
  where id = target_job;
  perform set_config('pickuply.schedule_write', '', true);
  insert into public.job_events (job_id, actor_id, type, data)
  values (
    target_job,
    uid,
    'pickup_timing_updated',
    jsonb_build_object('pickup_availability', next_availability)
  );
end;
$function$;

revoke all on function public.update_open_pickup_timing(uuid, text) from public, anon, service_role;
grant execute on function public.update_open_pickup_timing(uuid, text) to authenticated;

create or replace function public.keep_test_customer_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  customer_test boolean;
begin
  select is_test into customer_test from public.profiles where id = new.customer_id;
  if coalesce(customer_test, false) and not coalesce(new.is_test, false) then
    raise exception 'a request from a test customer stays a test request';
  end if;
  return new;
end;
$function$;

revoke all on function public.keep_test_customer_request() from public, anon, authenticated, service_role;

drop trigger if exists jobs_c_keep_test_customer on public.jobs;
create trigger jobs_c_keep_test_customer
  before insert or update on public.jobs
  for each row execute function public.keep_test_customer_request();
