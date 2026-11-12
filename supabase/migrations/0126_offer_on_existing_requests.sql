-- An offer can be sent without a pickup time. Existing requests keep the customer's timing.
-- A date, arrival time, or pickup window is checked only when the driver sends one.
-- Open requests that were still marked as test become regular requests, so approved drivers can offer.

update public.jobs
set is_test = false
where status = 'open' and is_test and test_retired_at is null;

create or replace function public.offer_schedule(
  target_job uuid,
  proposed_date text,
  proposed_time text,
  window_id uuid
)
returns table(start_at timestamptz, end_at timestamptz, chosen_window uuid)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  window_row public.job_pickup_windows%rowtype;
  arrival timestamptz;
  lead_minutes integer := public.pickup_offer_lead_minutes();
  sent_date text := nullif(btrim(coalesce(proposed_date, '')), '');
  sent_time text := nullif(btrim(coalesce(proposed_time, '')), '');
begin
  select * into job_row from public.jobs where id = target_job;
  if not found then
    raise exception 'job already taken';
  end if;

  if window_id is null and sent_date is null and sent_time is null then
    start_at := null;
    end_at := null;
    chosen_window := null;
    return next;
    return;
  end if;

  if job_row.pickup_availability is null then
    start_at := null;
    end_at := null;
    chosen_window := null;
    return next;
    return;
  end if;

  if job_row.pickup_availability in ('anytime', 'asap') then
    if window_id is not null or sent_date is null or sent_time is null then
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
  if sent_date is null and sent_time is null then
    start_at := window_row.starts_at;
    end_at := window_row.ends_at;
    chosen_window := window_row.id;
    return next;
    return;
  end if;
  if sent_date is null or sent_time is null then
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
$function$;
