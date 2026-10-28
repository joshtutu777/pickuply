-- Customer pickup availability and the driver's proposed pickup time.
-- Historical jobs keep a null availability and do not require a schedule.
-- Confirmed times are written only when an offer is chosen or a priced quote is claimed.
-- A later mutual reschedule would need its own request row, acceptance by both people,
-- and one audited write of scheduled_pickup_start. Do not reuse the free reschedule path.
-- In-app assignment alerts can append schedule_phrase. The eight SMS templates stay unchanged.

alter table public.jobs
  add column if not exists pickup_availability text,
  add column if not exists pickup_timezone text,
  add column if not exists scheduled_pickup_start timestamptz,
  add column if not exists scheduled_pickup_end timestamptz;

alter table public.jobs
  drop constraint if exists jobs_pickup_availability_check,
  drop constraint if exists jobs_pickup_timezone_check,
  drop constraint if exists jobs_scheduled_pickup_order_check,
  drop constraint if exists jobs_schedule_pair_check;

alter table public.jobs
  add constraint jobs_pickup_availability_check
    check (pickup_availability is null or pickup_availability in ('anytime', 'asap', 'windows')),
  add constraint jobs_pickup_timezone_check
    check (pickup_timezone is null or pickup_timezone = 'America/New_York'),
  add constraint jobs_scheduled_pickup_order_check
    check (
      scheduled_pickup_end is null
      or (scheduled_pickup_start is not null and scheduled_pickup_end > scheduled_pickup_start)
    ),
  add constraint jobs_schedule_pair_check
    check (
      (pickup_availability is null and pickup_timezone is null)
      or (pickup_availability is not null and pickup_timezone = 'America/New_York')
    );

alter table public.job_offers
  add column if not exists proposed_pickup_start timestamptz,
  add column if not exists proposed_pickup_end timestamptz,
  add column if not exists pickup_window_id uuid;

create table if not exists public.job_pickup_windows (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  position smallint not null check (position between 1 and 3),
  unique (job_id, position),
  check (ends_at > starts_at)
);

create index if not exists job_pickup_windows_job_id_idx
  on public.job_pickup_windows (job_id);

alter table public.job_offers
  drop constraint if exists job_offers_pickup_window_id_fkey;

alter table public.job_offers
  add constraint job_offers_pickup_window_id_fkey
  foreign key (pickup_window_id) references public.job_pickup_windows (id);

alter table public.job_pickup_windows enable row level security;

revoke all on public.job_pickup_windows from public, anon, authenticated;
grant select on public.job_pickup_windows to authenticated;

create or replace function public.pickup_instant(day text, clock text)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  moment timestamptz;
  wall text;
begin
  if day is null or clock is null
    or day !~ '^\d{4}-\d{2}-\d{2}$'
    or clock !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Enter a pickup date and time.';
  end if;
  moment := (day || ' ' || clock || ':00')::timestamp at time zone 'America/New_York';
  wall := to_char(moment at time zone 'America/New_York', 'YYYY-MM-DD HH24:MI');
  if wall is distinct from day || ' ' || clock then
    raise exception 'That time does not exist in the pickup time zone.';
  end if;
  return moment;
end;
$$;

create or replace function public.booking_instant_allowed(moment timestamptz)
returns boolean
language sql
stable
set search_path = public
as $$
  select moment is not null
    and public.booking_date_allowed(to_char(moment at time zone 'America/New_York', 'YYYY-MM-DD'));
$$;

create or replace function public.coarse_time_window(moment timestamptz)
returns public.time_window
language plpgsql
stable
set search_path = public
as $$
declare
  hour integer := extract(hour from moment at time zone 'America/New_York')::integer;
begin
  if hour < 12 then
    return 'morning';
  elsif hour < 17 then
    return 'afternoon';
  end if;
  return 'evening';
end;
$$;

create or replace function public.schedule_phrase(start_at timestamptz, end_at timestamptz)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when start_at is null then ''
    when end_at is null then
      ' Scheduled pickup: '
      || to_char(start_at at time zone 'America/New_York', 'Dy, Mon DD, HH12:MI AM')
      || ' ET.'
    else
      ' Scheduled pickup: '
      || to_char(start_at at time zone 'America/New_York', 'Dy, Mon DD, HH12:MI AM')
      || ' - '
      || to_char(end_at at time zone 'America/New_York', 'HH12:MI AM')
      || ' ET.'
  end;
$$;

create or replace function public.guard_confirmed_schedule()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_migration_session()
    or coalesce(current_setting('pickuply.schedule_write', true), '') = 'yes' then
    return new;
  end if;
  if new.scheduled_pickup_start is distinct from old.scheduled_pickup_start
    or new.scheduled_pickup_end is distinct from old.scheduled_pickup_end then
    if old.scheduled_pickup_start is not null then
      raise exception 'This pickup time is locked. Contact Pickuply support to change it.';
    end if;
    raise exception 'Pickup times can only be saved with the request.';
  end if;
  if new.pickup_availability is distinct from old.pickup_availability
    or new.pickup_timezone is distinct from old.pickup_timezone then
    raise exception 'Pickup times can only be saved with the request.';
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_confirmed_schedule on public.jobs;
create trigger jobs_confirmed_schedule
  before update of pickup_availability, pickup_timezone, scheduled_pickup_start, scheduled_pickup_end
  on public.jobs
  for each row execute function public.guard_confirmed_schedule();

create or replace function public.guard_pickup_windows()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_migration_session() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception 'customer pickup windows cannot be changed';
end;
$$;

drop trigger if exists job_pickup_windows_lock on public.job_pickup_windows;
create trigger job_pickup_windows_lock
  before update or delete on public.job_pickup_windows
  for each row execute function public.guard_pickup_windows();

create or replace function public.guard_window_count()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  saved integer;
  availability text;
begin
  if public.is_migration_session() then
    return new;
  end if;
  -- The request insert happens before the windows are saved, so use the row
  -- as it is at commit, not the values from the original insert.
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
$$;

drop trigger if exists jobs_window_count on public.jobs;
create constraint trigger jobs_window_count
  after insert or update of pickup_availability on public.jobs
  deferrable initially deferred
  for each row execute function public.guard_window_count();

create or replace function public.guard_offer_schedule()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_migration_session()
    or coalesce(current_setting('pickuply.schedule_write', true), '') = 'yes' then
    return new;
  end if;
  if tg_op = 'INSERT'
    and (new.proposed_pickup_start is not null or new.proposed_pickup_end is not null or new.pickup_window_id is not null) then
    raise exception 'send the pickup time with the offer';
  end if;
  if tg_op = 'UPDATE'
    and (
      new.proposed_pickup_start is distinct from old.proposed_pickup_start
      or new.proposed_pickup_end is distinct from old.proposed_pickup_end
      or new.pickup_window_id is distinct from old.pickup_window_id
    ) then
    raise exception 'the pickup time on this offer cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists job_offers_schedule_lock on public.job_offers;
create trigger job_offers_schedule_lock
  before insert or update of proposed_pickup_start, proposed_pickup_end, pickup_window_id
  on public.job_offers
  for each row execute function public.guard_offer_schedule();

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
    or window_row.ends_at <= now()
    or offer_row.proposed_pickup_start is distinct from window_row.starts_at
    or offer_row.proposed_pickup_end is distinct from window_row.ends_at then
    raise exception 'That pickup window has passed. Choose another offer.';
  end if;
end;
$$;

create or replace function public.driver_may_read_schedule(target_job uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  perform public.assert_driver_can_take_job(target_job, 'offer');
  return true;
exception
  when others then
    return false;
end;
$$;

drop policy if exists job_pickup_windows_select on public.job_pickup_windows;
create policy job_pickup_windows_select
  on public.job_pickup_windows
  for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.jobs
      where jobs.id = job_pickup_windows.job_id
        and (jobs.customer_id = auth.uid() or jobs.assigned_driver_id = auth.uid())
    )
    or public.driver_may_read_schedule(job_id)
  );

create or replace function public.open_job_schedules(job_ids uuid[])
returns table (
  job_id uuid,
  pickup_availability text,
  pickup_timezone text,
  windows jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or job_ids is null then
    return;
  end if;
  if cardinality(job_ids) > 50 then
    raise exception 'too many jobs';
  end if;
  return query
  select
    jobs.id,
    jobs.pickup_availability,
    jobs.pickup_timezone,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', windows.id,
        'starts_at', windows.starts_at,
        'ends_at', windows.ends_at,
        'position', windows.position
      ) order by windows.position)
      from public.job_pickup_windows windows
      where windows.job_id = jobs.id
    ), '[]'::jsonb)
  from public.jobs
  where jobs.id = any (job_ids)
    and (
      jobs.customer_id = auth.uid()
      or jobs.assigned_driver_id = auth.uid()
      or public.is_admin()
      or public.driver_may_read_schedule(jobs.id)
    );
end;
$$;

revoke all on function public.apply_pickup_schedule(uuid, jsonb) from public, anon, service_role;
revoke all on function public.offer_schedule(uuid, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.assert_saved_schedule(public.job_offers, public.jobs) from public, anon, authenticated, service_role;
revoke all on function public.driver_may_read_schedule(uuid) from public, anon, service_role;
revoke all on function public.open_job_schedules(uuid[]) from public, anon, service_role;
grant execute on function public.apply_pickup_schedule(uuid, jsonb) to authenticated;
grant execute on function public.driver_may_read_schedule(uuid) to authenticated;
grant execute on function public.open_job_schedules(uuid[]) to authenticated;

do $schedule_grants$
begin
  grant execute on function public.pickup_instant(text, text) to postgres;
  grant execute on function public.offer_schedule(uuid, text, text, uuid) to postgres;
  grant execute on function public.assert_saved_schedule(public.job_offers, public.jobs) to postgres;
  grant execute on function public.apply_pickup_schedule(uuid, jsonb) to postgres;
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    grant execute on function public.pickup_instant(text, text) to supabase_admin;
    grant execute on function public.offer_schedule(uuid, text, text, uuid) to supabase_admin;
    grant execute on function public.assert_saved_schedule(public.job_offers, public.jobs) to supabase_admin;
    grant execute on function public.apply_pickup_schedule(uuid, jsonb) to supabase_admin;
  end if;
end
$schedule_grants$;

do $schedule_patch$
declare
  src text;
  next text;
begin
  src := pg_get_functiondef('public.create_customer_request(uuid, jsonb)'::regprocedure);
  next := replace(
    src,
    $$'customer_email', 'access_notes', 'has_photo'$$,
    $$'customer_email', 'access_notes', 'has_photo', 'pickup_availability', 'pickup_windows'$$
  );
  if next = src then
    raise exception 'request fields were not found';
  end if;
  src := next;
  next := replace(
    src,
    'return request_id;',
    $body$perform public.apply_pickup_schedule(request_id, payload);
  return request_id;$body$
  );
  if next = src or (length(next) - length(replace(next, 'apply_pickup_schedule', ''))) / length('apply_pickup_schedule') <> 3 then
    raise exception 'pickup schedule was not attached to every save';
  end if;
  execute next;

  src := pg_get_functiondef('public.submit_offer(uuid, text, integer, text)'::regprocedure);
  next := replace(
    src,
    'CREATE OR REPLACE FUNCTION public.submit_offer(target_job uuid, kind text, earnings_cents integer, reason text)',
    'CREATE OR REPLACE FUNCTION public.submit_offer(target_job uuid, kind text, earnings_cents integer, reason text, proposed_date text default null, proposed_time text default null, window_id uuid default null)'
  );
  if next = src then
    raise exception 'submit_offer signature was not found';
  end if;
  src := next;
  next := replace(
    src,
    '  offer_id uuid;',
    $body$  offer_id uuid;
  sched_start timestamptz;
  sched_end timestamptz;
  sched_window uuid;$body$
  );
  if next = src then
    raise exception 'submit_offer declarations were not found';
  end if;
  src := next;
  next := replace(
    src,
    '  insert into public.job_offers (',
    $body$  select picked.start_at, picked.end_at, picked.chosen_window
    into sched_start, sched_end, sched_window
    from public.offer_schedule(target_job, proposed_date, proposed_time, window_id) as picked;
  perform set_config('pickuply.schedule_write', 'yes', true);
  insert into public.job_offers ($body$
  );
  if next = src then
    raise exception 'submit_offer insert was not found';
  end if;
  src := next;
  next := replace(
    src,
    'customer_total_cents, commission_bps, reason, outside_range, status, expires_at',
    'customer_total_cents, commission_bps, reason, outside_range, status, expires_at, proposed_pickup_start, proposed_pickup_end, pickup_window_id'
  );
  if next = src then
    raise exception 'submit_offer columns were not found';
  end if;
  src := next;
  next := replace(
    src,
    'outside, ''active'', now() + interval ''2 hours''',
    'outside, ''active'', now() + interval ''2 hours'', sched_start, sched_end, sched_window'
  );
  if next = src then
    raise exception 'submit_offer values were not found';
  end if;
  src := next;
  next := replace(
    src,
    '  return offer_id;',
    $body$  perform set_config('pickuply.schedule_write', '', true);
  return offer_id;$body$
  );
  if next = src then
    raise exception 'submit_offer return was not found';
  end if;
  drop function public.submit_offer(uuid, text, integer, text);
  execute next;
  revoke all on function public.submit_offer(uuid, text, integer, text, text, text, uuid) from public, anon, service_role;
  grant execute on function public.submit_offer(uuid, text, integer, text, text, text, uuid) to authenticated;

  src := replace(pg_get_functiondef('public.choose_offer(uuid)'::regprocedure), chr(13), '');
  next := replace(
    src,
    replace($body$  where job_id = offer_row.job_id and id <> target_offer and status = 'active';
  update public.jobs
  set
    status = 'assigned',$body$, chr(13), ''),
    replace($body$  where job_id = offer_row.job_id and id <> target_offer and status = 'active';
  perform public.assert_saved_schedule(offer_row, job_row);
  perform set_config('pickuply.schedule_write', 'yes', true);
  update public.jobs
  set
    status = 'assigned',$body$, chr(13), '')
  );
  if next = src then
    raise exception 'choose_offer assignment was not found';
  end if;
  src := next;
  next := replace(
    src,
    'payment_due_at = public.payment_due_at()',
    $body$payment_due_at = public.payment_due_at(),
    scheduled_pickup_start = case
      when job_row.pickup_availability is null then scheduled_pickup_start
      else offer_row.proposed_pickup_start
    end,
    scheduled_pickup_end = case
      when job_row.pickup_availability is null then scheduled_pickup_end
      else offer_row.proposed_pickup_end
    end$body$
  );
  if next = src then
    raise exception 'choose_offer schedule columns were not found';
  end if;
  src := replace(next, chr(13), '');
  next := replace(
    src,
    replace($body$  where id = offer_row.job_id;
  insert into public.job_events (job_id, actor_id, type, data)
  values (
    offer_row.job_id, uid, 'offer_chosen',$body$, chr(13), ''),
    replace($body$  where id = offer_row.job_id;
  perform set_config('pickuply.schedule_write', '', true);
  insert into public.job_events (job_id, actor_id, type, data)
  values (
    offer_row.job_id, uid, 'offer_chosen',$body$, chr(13), '')
  );
  if next = src then
    raise exception 'choose_offer cleanup was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.claim_job(uuid)'::regprocedure), chr(13), '');
  next := replace(
    src,
    'CREATE OR REPLACE FUNCTION public.claim_job(target_job uuid)',
    'CREATE OR REPLACE FUNCTION public.claim_job(target_job uuid, proposed_date text default null, proposed_time text default null, window_id uuid default null)'
  );
  if next = src then
    raise exception 'claim_job signature was not found';
  end if;
  src := next;
  next := replace(
    src,
    '  job_row public.jobs%rowtype;',
    $body$  job_row public.jobs%rowtype;
  sched_start timestamptz;
  sched_end timestamptz;
  sched_window uuid;$body$
  );
  if next = src then
    raise exception 'claim_job declarations were not found';
  end if;
  src := next;
  next := replace(
    src,
    replace($body$  perform set_config('pickuply.job_claimed', 'yes', true);
  update public.jobs
  set
    status = 'assigned',
    assigned_driver_id = uid,
    payment_status = 'awaiting_payment',
    payment_due_at = public.payment_due_at()
  where id = target_job;$body$, chr(13), ''),
    replace($body$  select picked.start_at, picked.end_at, picked.chosen_window
    into sched_start, sched_end, sched_window
    from public.offer_schedule(target_job, proposed_date, proposed_time, window_id) as picked;
  perform set_config('pickuply.job_claimed', 'yes', true);
  perform set_config('pickuply.schedule_write', 'yes', true);
  update public.jobs
  set
    status = 'assigned',
    assigned_driver_id = uid,
    payment_status = 'awaiting_payment',
    payment_due_at = public.payment_due_at(),
    scheduled_pickup_start = case
      when job_row.pickup_availability is null then scheduled_pickup_start
      else sched_start
    end,
    scheduled_pickup_end = case
      when job_row.pickup_availability is null then scheduled_pickup_end
      else sched_end
    end
  where id = target_job;$body$, chr(13), '')
  );
  if next = src then
    raise exception 'claim_job assignment was not found';
  end if;
  src := replace(next, chr(13), '');
  next := replace(
    src,
    replace($body$  where id = target_job;

  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, uid, 'claimed',$body$, chr(13), ''),
    replace($body$  where id = target_job;
  perform set_config('pickuply.schedule_write', '', true);

  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, uid, 'claimed',$body$, chr(13), '')
  );
  if next = src then
    raise exception 'claim_job cleanup was not found';
  end if;
  drop function public.claim_job(uuid);
  execute next;
  revoke all on function public.claim_job(uuid, text, text, uuid) from public, anon, service_role;
  grant execute on function public.claim_job(uuid, text, text, uuid) to authenticated;

  src := replace(pg_get_functiondef('public.notify_on_job()'::regprocedure), chr(13), '');
  next := replace(
    src,
    $$'A driver is confirmed for your request in ' || area || '.'$$,
    $$'A driver is confirmed for your request in ' || area || '.' || public.schedule_phrase(new.scheduled_pickup_start, new.scheduled_pickup_end)$$
  );
  if next = src then
    raise exception 'customer assignment alert was not found';
  end if;
  src := next;
  next := replace(
    src,
    replace($body$'The customer chose you for a job in ' || area || '.'
            || case when earn is null then '' else ' Your earnings are ' || earn || '.' end,
          '/driver/jobs/' || new.id, 'assigned:' || new.id$body$, chr(13), ''),
    replace($body$'The customer chose you for a job in ' || area || '.'
            || case when earn is null then '' else ' Your earnings are ' || earn || '.' end
            || public.schedule_phrase(new.scheduled_pickup_start, new.scheduled_pickup_end),
          '/driver/jobs/' || new.id, 'assigned:' || new.id$body$, chr(13), '')
  );
  if next = src then
    raise exception 'driver assignment alert was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.request_reschedule(uuid, text, text)'::regprocedure), chr(13), '');
  next := replace(
    src,
    replace($body$    raise exception 'only the customer can reschedule this job';
  end if;$body$, chr(13), ''),
    replace($body$    raise exception 'only the customer can reschedule this job';
  end if;
  if job_row.scheduled_pickup_start is not null then
    raise exception 'This pickup time is locked. Contact Pickuply support to change it.';
  end if;$body$, chr(13), '')
  );
  if next = src then
    raise exception 'request reschedule guard was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.respond_reschedule(uuid, boolean)'::regprocedure), chr(13), '');
  next := replace(
    src,
    replace($body$    raise exception 'only the assigned driver can answer';
  end if;$body$, chr(13), ''),
    replace($body$    raise exception 'only the assigned driver can answer';
  end if;
  if job_row.scheduled_pickup_start is not null then
    raise exception 'This pickup time is locked. Contact Pickuply support to change it.';
  end if;$body$, chr(13), '')
  );
  if next = src then
    raise exception 'reschedule answer guard was not found';
  end if;
  execute next;
end
$schedule_patch$;

drop function if exists public.offer_summaries(uuid);

create function public.offer_summaries(target_job uuid)
returns table (
  offer_id uuid,
  driver_first_name text,
  vehicle_label text,
  jobs_completed integer,
  reason text,
  outside_range boolean,
  customer_total_cents integer,
  driver_earnings_cents integer,
  platform_fee_cents integer,
  service_fee_cents integer,
  status public.offer_status,
  expires_at timestamptz,
  viewed boolean,
  rating_avg numeric,
  review_count integer,
  proposed_pickup_start timestamptz,
  proposed_pickup_end timestamptz,
  pickup_window_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if not exists (
    select 1 from public.jobs
    where id = target_job and (customer_id = auth.uid() or public.is_admin())
  ) then
    return;
  end if;

  return query
  select
    offers.id,
    split_part(coalesce(profiles.full_name, 'Driver'), ' ', 1),
    trim(both ' ' from coalesce(vehicles.type::text, '') || ' ' || coalesce(vehicles.make, '')),
    (
      select count(*)::integer
      from public.jobs finished
      where finished.assigned_driver_id = offers.driver_id
        and finished.status = 'completed'
    ),
    offers.reason,
    offers.outside_range,
    offers.customer_total_cents,
    offers.driver_amount_cents,
    offers.platform_fee_cents,
    offers.service_fee_cents,
    offers.status,
    offers.expires_at,
    exists (
      select 1 from public.offer_views
      where offer_views.offer_id = offers.id
    ),
    (
      select round(avg(reviews.stars)::numeric, 1)
      from public.job_reviews reviews
      where reviews.reviewee_id = offers.driver_id
        and reviews.reviewer_role = 'customer'
        and reviews.hidden_at is null
        and public.review_is_published(reviews.job_id, reviews.created_at)
    ),
    (
      select count(*)::integer
      from public.job_reviews reviews
      where reviews.reviewee_id = offers.driver_id
        and reviews.reviewer_role = 'customer'
        and reviews.hidden_at is null
        and public.review_is_published(reviews.job_id, reviews.created_at)
    ),
    offers.proposed_pickup_start,
    offers.proposed_pickup_end,
    offers.pickup_window_id
  from public.job_offers offers
  join public.profiles on profiles.id = offers.driver_id
  join public.drivers on drivers.profile_id = offers.driver_id
  left join lateral (
    select type, make
    from public.vehicles
    where driver_id = offers.driver_id
    order by approved desc, created_at desc
    limit 1
  ) vehicles on true
  where offers.job_id = target_job
    and offers.status = 'active'
    and offers.expires_at > now();
end;
$$;

revoke all on function public.offer_summaries(uuid) from public, anon, service_role;
grant execute on function public.offer_summaries(uuid) to authenticated;
