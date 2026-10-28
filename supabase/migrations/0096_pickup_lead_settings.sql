-- Admin settings for the two later pickup checks.
-- Accepting a customer window requires that much time still left (default 60).
-- A driver's Anytime or ASAP arrival must be that far ahead when the offer is sent (default 30).
-- Saving a customer window still uses the fixed 60-minute rule from 0095.

alter table public.platform_settings
  add column if not exists accept_window_lead_minutes integer not null default 60,
  add column if not exists offer_arrival_lead_minutes integer not null default 30;

alter table public.platform_settings
  drop constraint if exists platform_settings_accept_window_lead_check,
  drop constraint if exists platform_settings_offer_arrival_lead_check;

alter table public.platform_settings
  add constraint platform_settings_accept_window_lead_check
    check (accept_window_lead_minutes between 0 and 1440),
  add constraint platform_settings_offer_arrival_lead_check
    check (offer_arrival_lead_minutes between 0 and 1440);

create or replace function public.pickup_accept_lead_minutes()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select accept_window_lead_minutes from public.platform_settings where id = 1), 60);
$$;

create or replace function public.pickup_offer_lead_minutes()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select offer_arrival_lead_minutes from public.platform_settings where id = 1), 30);
$$;

revoke all on function public.pickup_accept_lead_minutes() from public, anon, authenticated, service_role;
revoke all on function public.pickup_offer_lead_minutes() from public, anon, authenticated, service_role;

create or replace function public.set_pickup_lead_minutes(accept_minutes integer, offer_minutes integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can change settings';
  end if;
  if accept_minutes is null or accept_minutes < 0 or accept_minutes > 1440
    or offer_minutes is null or offer_minutes < 0 or offer_minutes > 1440 then
    raise exception 'Enter a lead time from 0 to 1440 minutes.';
  end if;
  update public.platform_settings
  set accept_window_lead_minutes = accept_minutes,
      offer_arrival_lead_minutes = offer_minutes,
      updated_at = now()
  where id = 1;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'set_pickup_lead_minutes',
    'platform_settings',
    null,
    jsonb_build_object(
      'accept_window_lead_minutes', accept_minutes,
      'offer_arrival_lead_minutes', offer_minutes
    )
  );
end;
$$;

revoke all on function public.set_pickup_lead_minutes(integer, integer) from public, anon, service_role;
grant execute on function public.set_pickup_lead_minutes(integer, integer) to authenticated;

create or replace function public.offer_schedule(
  target_job uuid,
  proposed_date text,
  proposed_time text,
  window_id uuid
)
returns table (start_at timestamptz, end_at timestamptz, chosen_window uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
  window_row public.job_pickup_windows%rowtype;
  arrival timestamptz;
  lead_minutes integer := public.pickup_offer_lead_minutes();
begin
  select * into job_row from public.jobs where id = target_job;
  if not found then
    raise exception 'job already taken';
  end if;
  if job_row.pickup_availability is null then
    start_at := null;
    end_at := null;
    chosen_window := null;
    return next;
    return;
  end if;
  if job_row.pickup_availability in ('anytime', 'asap') then
    if window_id is not null
      or nullif(btrim(coalesce(proposed_date, '')), '') is null
      or nullif(btrim(coalesce(proposed_time, '')), '') is null then
      raise exception 'Enter the pickup date and arrival time.';
    end if;
    arrival := public.pickup_instant(proposed_date, proposed_time);
    if arrival <= now() then
      raise exception 'That pickup time has passed. Choose a later time.';
    end if;
    if arrival < now() + make_interval(mins => lead_minutes) then
      raise exception 'Choose an arrival at least % minutes from now.', lead_minutes;
    end if;
    if not public.booking_instant_allowed(arrival) then
      raise exception 'Choose a pickup time within the next 6 days.';
    end if;
    start_at := arrival;
    end_at := null;
    chosen_window := null;
    return next;
    return;
  end if;
  if window_id is null then
    raise exception 'Select one of the customer pickup windows.';
  end if;
  select * into window_row
  from public.job_pickup_windows
  where id = window_id and job_id = target_job;
  if not found then
    raise exception 'Select one of the customer pickup windows.';
  end if;
  if window_row.ends_at <= now() then
    raise exception 'That pickup window has passed. Choose another time.';
  end if;
  start_at := window_row.starts_at;
  end_at := window_row.ends_at;
  chosen_window := window_row.id;
  return next;
end;
$$;

create or replace function public.assert_saved_schedule(
  offer_row public.job_offers,
  job_row public.jobs
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  window_row public.job_pickup_windows%rowtype;
  accept_lead integer := public.pickup_accept_lead_minutes();
begin
  if job_row.pickup_availability is null then
    return;
  end if;
  if job_row.pickup_availability in ('anytime', 'asap') then
    if offer_row.proposed_pickup_start is null
      or offer_row.proposed_pickup_end is not null
      or offer_row.pickup_window_id is not null
      or offer_row.proposed_pickup_start <= now()
      or not public.booking_instant_allowed(offer_row.proposed_pickup_start) then
      raise exception 'That pickup time has passed. Choose another offer.';
    end if;
    return;
  end if;
  select * into window_row
  from public.job_pickup_windows
  where id = offer_row.pickup_window_id and job_id = job_row.id;
  if not found
    or offer_row.proposed_pickup_start is distinct from window_row.starts_at
    or offer_row.proposed_pickup_end is distinct from window_row.ends_at then
    raise exception 'That pickup window has passed. Choose another offer.';
  end if;
  if window_row.ends_at < now() + make_interval(mins => accept_lead) then
    raise exception 'This time has passed. Choose another offer.';
  end if;
end;
$$;
