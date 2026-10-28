-- Customer pickup windows must end at least 60 minutes after they are saved.
-- Anytime and ASAP still have no customer window. A driver's proposed arrival
-- only has to be in the future. Offer selection and acceptance do not ask for
-- another 60 minutes; they reject a window only after its end has passed.
--
-- Rollback, before this application version is deployed:
-- restore apply_pickup_schedule from 0092, which only rejects an end time
-- that is already past. Do not drop columns or the window table.
-- After this application version is deployed, roll the application back
-- before rolling this function back. 0092, 0093, and 0094 stay in place.

create or replace function public.apply_pickup_schedule(target_job uuid, payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  availability text;
  windows jsonb;
  entry jsonb;
  spot integer := 0;
  day text;
  start_clock text;
  end_clock text;
  start_at timestamptz;
  end_at timestamptz;
  previous_end timestamptz;
  first_start timestamptz;
  extra text;
  saved_count integer;
  matched boolean;
begin
  if payload is null or not (payload ? 'pickup_availability') then
    return;
  end if;
  if uid is null then
    raise exception 'sign in required';
  end if;
  availability := payload->>'pickup_availability';
  if availability not in ('anytime', 'asap', 'windows') then
    raise exception 'Choose when the item is available for pickup.';
  end if;
  windows := payload->'pickup_windows';
  if windows is null or jsonb_typeof(windows) = 'null' then
    windows := '[]'::jsonb;
  end if;
  if jsonb_typeof(windows) is distinct from 'array' then
    raise exception 'Add between 1 and 3 pickup windows.';
  end if;
  if availability in ('anytime', 'asap') and jsonb_array_length(windows) > 0 then
    raise exception 'This choice does not use pickup windows.';
  end if;
  if availability = 'windows' and jsonb_array_length(windows) not between 1 and 3 then
    raise exception 'Add between 1 and 3 pickup windows.';
  end if;

  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from uid then
    raise exception 'only the customer can set pickup times';
  end if;
  if job_row.status is distinct from 'open'
    or job_row.assigned_driver_id is not null
    or job_row.accepted_offer_id is not null
    or job_row.scheduled_pickup_start is not null then
    raise exception 'pickup times can no longer be changed';
  end if;

  if job_row.pickup_availability is not null then
    select count(*)::integer into saved_count
    from public.job_pickup_windows
    where job_id = target_job;
    matched := job_row.pickup_availability = availability
      and saved_count = case when availability = 'windows' then jsonb_array_length(windows) else 0 end;
    if matched and availability = 'windows' then
      spot := 0;
      for entry in select value from jsonb_array_elements(windows)
      loop
        spot := spot + 1;
        if not exists (
          select 1 from public.job_pickup_windows
          where job_id = target_job
            and position = spot
            and starts_at = public.pickup_instant(entry->>'date', entry->>'start')
            and ends_at = public.pickup_instant(entry->>'date', entry->>'end')
        ) then
          matched := false;
        end if;
      end loop;
    end if;
    if matched then
      return;
    end if;
    raise exception 'this request was already saved with different details';
  end if;

  perform set_config('pickuply.schedule_write', 'yes', true);
  if availability = 'windows' then
    previous_end := null;
    first_start := null;
    spot := 0;
    for entry in select value from jsonb_array_elements(windows)
    loop
      spot := spot + 1;
      select k into extra
      from jsonb_object_keys(entry) as k
      where k not in ('date', 'start', 'end')
      limit 1;
      if extra is not null then
        raise exception 'Enter a pickup date, start time, and end time.';
      end if;
      day := entry->>'date';
      start_clock := entry->>'start';
      end_clock := entry->>'end';
      if not public.booking_date_allowed(day) then
        raise exception 'Choose a date within the next 6 days.';
      end if;
      start_at := public.pickup_instant(day, start_clock);
      end_at := public.pickup_instant(day, end_clock);
      if end_at <= start_at then
        raise exception 'The end time has to be later than the start time.';
      end if;
      if end_at <= now() then
        raise exception 'A pickup window cannot be entirely in the past.';
      end if;
      if end_at < now() + interval '60 minutes' then
        raise exception 'The pickup window has to end at least 60 minutes from now.';
      end if;
      if previous_end is not null and start_at < previous_end and previous_end > start_at then
        if exists (
          select 1
          from public.job_pickup_windows existing
          where existing.job_id = target_job
            and existing.starts_at < end_at
            and start_at < existing.ends_at
        ) then
          raise exception 'Pickup windows cannot overlap.';
        end if;
      end if;
      if exists (
        select 1
        from public.job_pickup_windows existing
        where existing.job_id = target_job
          and existing.starts_at < end_at
          and start_at < existing.ends_at
      ) then
        raise exception 'Pickup windows cannot overlap.';
      end if;
      insert into public.job_pickup_windows (job_id, starts_at, ends_at, position)
      values (target_job, start_at, end_at, spot);
      previous_end := end_at;
      if first_start is null then
        first_start := start_at;
      end if;
    end loop;
    update public.jobs
    set pickup_availability = 'windows',
        pickup_timezone = 'America/New_York',
        preferred_date = to_char(first_start at time zone 'America/New_York', 'YYYY-MM-DD'),
        time_window = public.coarse_time_window(first_start)
    where id = target_job;
  else
    update public.jobs
    set pickup_availability = availability,
        pickup_timezone = 'America/New_York',
        preferred_date = 'asap',
        time_window = null
    where id = target_job;
  end if;
  perform set_config('pickuply.schedule_write', '', true);
end;
$$;
