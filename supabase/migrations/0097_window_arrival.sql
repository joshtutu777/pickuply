-- A driver who selects a customer window may also propose an exact arrival inside it.
-- The new app sends that date and time. The offer stores the instant and an empty end.
-- The current app sends the window only. That offer still stores the whole window.
-- Accepting either shape uses the existing rules. Confirmed rows are not rewritten.
-- Anytime and As soon as possible keep the existing arrival rules.

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
  if nullif(btrim(coalesce(proposed_date, '')), '') is null
    and nullif(btrim(coalesce(proposed_time, '')), '') is null then
    start_at := window_row.starts_at;
    end_at := window_row.ends_at;
    chosen_window := window_row.id;
    return next;
    return;
  end if;
  if nullif(btrim(coalesce(proposed_date, '')), '') is null
    or nullif(btrim(coalesce(proposed_time, '')), '') is null then
    raise exception 'Enter an arrival time inside the pickup window.';
  end if;
  arrival := public.pickup_instant(proposed_date, proposed_time);
  if arrival < window_row.starts_at or arrival > window_row.ends_at then
    raise exception 'Choose an arrival inside the pickup window.';
  end if;
  if arrival <= now() then
    raise exception 'That pickup time has passed. Choose a later time.';
  end if;
  start_at := arrival;
  end_at := null;
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
  if not found then
    raise exception 'That pickup window has passed. Choose another offer.';
  end if;
  if offer_row.proposed_pickup_start is not distinct from window_row.starts_at
    and offer_row.proposed_pickup_end is not distinct from window_row.ends_at then
    if window_row.ends_at < now() + make_interval(mins => accept_lead) then
      raise exception 'This time has passed. Choose another offer.';
    end if;
    return;
  end if;
  if offer_row.proposed_pickup_end is not null
    or offer_row.proposed_pickup_start is null
    or offer_row.proposed_pickup_start < window_row.starts_at
    or offer_row.proposed_pickup_start > window_row.ends_at then
    raise exception 'That pickup window has passed. Choose another offer.';
  end if;
  if offer_row.proposed_pickup_start <= now() then
    raise exception 'That pickup time has passed. Choose another offer.';
  end if;
  if window_row.ends_at < now() + make_interval(mins => accept_lead) then
    raise exception 'This time has passed. Choose another offer.';
  end if;
end;
$$;
