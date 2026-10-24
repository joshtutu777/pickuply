-- Driver feed sections. Waves off: every eligible open Georgia request is
-- visible at once. Matched for You is coverage. All Georgia Requests is the rest.
-- The signal table carries no job, address, or customer data. Clients refetch
-- the feed functions, which still apply eligibility and row security.

create table public.job_feed_signals (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);

alter table public.job_feed_signals enable row level security;

create policy job_feed_signals_select on public.job_feed_signals
  for select to authenticated
  using (
    exists (
      select 1
      from public.drivers
      join public.profiles on profiles.id = drivers.profile_id
      where drivers.profile_id = auth.uid()
        and drivers.status <> 'removed'
        and not profiles.blocked
    )
  );

revoke all on table public.job_feed_signals from public, anon, authenticated, service_role;
grant select on table public.job_feed_signals to authenticated;

create or replace function public.note_job_feed_signal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'open' and new.paused_at is null then
      delete from public.job_feed_signals where created_at < now() - interval '1 day';
      insert into public.job_feed_signals default values;
    end if;
  elsif new.status is distinct from old.status or new.paused_at is distinct from old.paused_at then
    if new.status = 'open' or old.status = 'open' then
      delete from public.job_feed_signals where created_at < now() - interval '1 day';
      insert into public.job_feed_signals default values;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.note_job_feed_signal() from public, anon, authenticated, service_role;

drop trigger if exists jobs_note_feed_signal on public.jobs;
create trigger jobs_note_feed_signal
  after insert or update of status, paused_at on public.jobs
  for each row execute function public.note_job_feed_signal();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'job_feed_signals'
     ) then
    alter publication supabase_realtime add table public.job_feed_signals;
  end if;
end $$;

create or replace function public.feed_date_group(preferred text)
returns text
language sql
stable
as $$
  select case
    when preferred in ('asap', 'today') then 'today'
    when preferred ~ '^\d{4}-\d{2}-\d{2}$'
      and preferred::date <= (timezone('America/New_York', now()))::date
      then 'today'
    when preferred ~ '^\d{4}-\d{2}-\d{2}$'
      and preferred::date = (timezone('America/New_York', now()))::date + 1
      then 'tomorrow'
    when preferred ~ '^\d{4}-\d{2}-\d{2}$'
      and preferred::date <= (date_trunc('week', timezone('America/New_York', now()))::date + 6)
      then 'later_week'
    else 'later'
  end;
$$;

revoke all on function public.feed_date_group(text) from public, anon, authenticated, service_role;

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

revoke all on function public.driver_browse_jobs() from public, anon, authenticated, service_role;

create or replace function public.driver_matched_feed()
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
  date_group text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rows.id,
    rows.service,
    rows.pieces,
    rows.size,
    rows.pickup_area,
    rows.dropoff_area,
    rows.distance_miles,
    rows.stairs_pickup,
    rows.stairs_dropoff,
    rows.elevator,
    rows.help_loading,
    rows.preferred_date,
    rows.time_window,
    rows.pricing_method,
    rows.offer_cents,
    rows.budget_min_cents,
    rows.budget_max_cents,
    rows.driver_pay_cents,
    rows.quote_expires_at,
    rows.junk_load_size,
    rows.service_level,
    rows.required_vehicle,
    rows.created_at,
    rows.miles_from_you,
    rows.date_group
  from public.driver_browse_jobs() as rows
  where rows.matched
  order by
    case rows.date_group
      when 'today' then 0
      when 'tomorrow' then 1
      when 'later_week' then 2
      else 3
    end,
    rows.miles_from_you asc nulls last,
    rows.created_at desc,
    rows.id;
$$;

revoke all on function public.driver_matched_feed() from public, anon, service_role;
grant execute on function public.driver_matched_feed() to authenticated;

create or replace function public.driver_georgia_page(
  p_limit integer default 20,
  p_offset integer default 0,
  p_sort text default 'nearest',
  p_service text default null,
  p_max_miles integer default null,
  p_date text default 'any',
  p_vehicle_fit boolean default false
)
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
  date_group text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sort_key text := case
    when p_sort in ('nearest', 'newest', 'pay', 'soonest', 'farthest') then p_sort
    else 'nearest'
  end;
  service_name text := case
    when p_service in ('delivery', 'free_item', 'junk', 'construction') then p_service
    else null
  end;
  miles_cap integer := case when p_max_miles in (10, 25, 50, 100) then p_max_miles else null end;
  date_key text := case when p_date in ('today', 'tomorrow', 'week') then p_date else 'any' end;
  row_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  row_offset integer := greatest(coalesce(p_offset, 0), 0);
  uid uuid := auth.uid();
begin
  return query
  select
    rows.id,
    rows.service,
    rows.pieces,
    rows.size,
    rows.pickup_area,
    rows.dropoff_area,
    rows.distance_miles,
    rows.stairs_pickup,
    rows.stairs_dropoff,
    rows.elevator,
    rows.help_loading,
    rows.preferred_date,
    rows.time_window,
    rows.pricing_method,
    rows.offer_cents,
    rows.budget_min_cents,
    rows.budget_max_cents,
    rows.driver_pay_cents,
    rows.quote_expires_at,
    rows.junk_load_size,
    rows.service_level,
    rows.required_vehicle,
    rows.created_at,
    rows.miles_from_you,
    rows.date_group
  from public.driver_browse_jobs() as rows
  where not rows.matched
    and (service_name is null or rows.service = service_name::public.job_service)
    and (miles_cap is null or rows.miles_from_you <= miles_cap)
    and (
      date_key = 'any'
      or (date_key = 'today' and rows.date_group = 'today')
      or (date_key = 'tomorrow' and rows.date_group = 'tomorrow')
      or (date_key = 'week' and rows.date_group in ('today', 'tomorrow', 'later_week'))
    )
    and (
      not coalesce(p_vehicle_fit, false)
      or rows.required_vehicle is null
      or exists (
        select 1 from public.vehicles
        where vehicles.driver_id = uid
          and vehicles.approved
          and vehicles.type = rows.required_vehicle
      )
    )
  order by
    case when sort_key = 'farthest' then rows.miles_from_you end desc nulls last,
    case when sort_key = 'nearest' then rows.miles_from_you end asc nulls last,
    case when sort_key = 'newest' then rows.created_at end desc nulls last,
    case when sort_key = 'pay' then coalesce(rows.offer_cents, rows.budget_max_cents, rows.driver_pay_cents) end desc nulls last,
    case when sort_key = 'soonest' then
      case rows.date_group
        when 'today' then 0
        when 'tomorrow' then 1
        when 'later_week' then 2
        else 3
      end
    end asc nulls last,
    case when sort_key = 'soonest' then rows.preferred_date end asc nulls last,
    rows.created_at desc,
    rows.id
  limit row_limit
  offset row_offset;
end;
$$;

revoke all on function public.driver_georgia_page(integer, integer, text, text, integer, text, boolean)
  from public, anon, service_role;
grant execute on function public.driver_georgia_page(integer, integer, text, text, integer, text, boolean)
  to authenticated;

create or replace function public.driver_georgia_count(
  p_service text default null,
  p_max_miles integer default null,
  p_date text default 'any',
  p_vehicle_fit boolean default false
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  service_name text := case
    when p_service in ('delivery', 'free_item', 'junk', 'construction') then p_service
    else null
  end;
  miles_cap integer := case when p_max_miles in (10, 25, 50, 100) then p_max_miles else null end;
  date_key text := case when p_date in ('today', 'tomorrow', 'week') then p_date else 'any' end;
  uid uuid := auth.uid();
begin
  return (
    select count(*)::integer
    from public.driver_browse_jobs() as rows
    where not rows.matched
      and (service_name is null or rows.service = service_name::public.job_service)
      and (miles_cap is null or rows.miles_from_you <= miles_cap)
      and (
        date_key = 'any'
        or (date_key = 'today' and rows.date_group = 'today')
        or (date_key = 'tomorrow' and rows.date_group = 'tomorrow')
        or (date_key = 'week' and rows.date_group in ('today', 'tomorrow', 'later_week'))
      )
      and (
        not coalesce(p_vehicle_fit, false)
        or rows.required_vehicle is null
        or exists (
          select 1 from public.vehicles
          where vehicles.driver_id = uid
            and vehicles.approved
            and vehicles.type = rows.required_vehicle
        )
      )
  );
end;
$$;

revoke all on function public.driver_georgia_count(text, integer, text, boolean)
  from public, anon, service_role;
grant execute on function public.driver_georgia_count(text, integer, text, boolean)
  to authenticated;
