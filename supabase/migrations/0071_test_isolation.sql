-- Synthetic accounts stay in their own lane.
-- Real customers and drivers cannot see test jobs, offers, messages, or alerts.
-- A test admin cannot read or change real account data.
-- A real admin can read both lanes. Admin lists hide the test lane unless that view asks for it.
-- Cleanup retires test rows. It does not delete payments, ledger lines, messages, or the audit log.

alter table public.profiles
  add column is_test boolean not null default false,
  add column test_retired_at timestamptz;

alter table public.jobs
  add column is_test boolean not null default false,
  add column test_retired_at timestamptz;

alter table public.job_feed_signals
  add column is_test boolean not null default false;

alter table public.admin_announcements
  add column audience_is_test boolean not null default false;

alter table public.job_payments
  add column stripe_livemode boolean;

create index profiles_is_test_idx on public.profiles (is_test) where is_test;
create index jobs_is_test_idx on public.jobs (is_test) where is_test;

create or replace function public.actor_is_test()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_test from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.profile_is_test(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_test from public.profiles where id = target), false);
$$;

create or replace function public.job_is_test(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_test from public.jobs where id = target), false);
$$;

-- A real admin may see both lanes. Everyone else stays on their own flag.
create or replace function public.test_lane_matches(row_is_test boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_admin() and not public.actor_is_test() then true
    else coalesce(row_is_test, false) = public.actor_is_test()
  end;
$$;

revoke all on function public.actor_is_test() from public, anon, service_role;
revoke all on function public.profile_is_test(uuid) from public, anon, service_role;
revoke all on function public.job_is_test(uuid) from public, anon, service_role;
revoke all on function public.test_lane_matches(boolean) from public, anon, service_role;
grant execute on function public.actor_is_test() to authenticated;
grant execute on function public.profile_is_test(uuid) to authenticated;
grant execute on function public.job_is_test(uuid) to authenticated;
grant execute on function public.test_lane_matches(boolean) to authenticated;

create or replace function public.stamp_job_test_lane()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.profiles
    where id = new.customer_id and test_retired_at is not null
  ) then
    raise exception 'this test account is retired';
  end if;
  new.is_test := public.profile_is_test(new.customer_id);
  return new;
end;
$$;

drop trigger if exists jobs_a_stamp_test_lane on public.jobs;
create trigger jobs_a_stamp_test_lane
  before insert on public.jobs
  for each row execute function public.stamp_job_test_lane();

create or replace function public.guard_test_lane_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_test boolean;
  new_row jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  old_row jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
begin
  if tg_table_name = 'profiles' and tg_op = 'UPDATE'
    and (new_row ->> 'is_test') is distinct from (old_row ->> 'is_test') then
    if not public.is_migration_session() then
      raise exception 'test classification cannot be changed from the app';
    end if;
  end if;

  if tg_table_name = 'jobs' and tg_op = 'UPDATE'
    and (new_row ->> 'is_test') is distinct from (old_row ->> 'is_test') then
    if not public.is_migration_session() then
      raise exception 'test classification cannot be changed from the app';
    end if;
  end if;

  if tg_table_name = 'jobs' and tg_op <> 'DELETE'
    and nullif(new_row ->> 'assigned_driver_id', '') is not null
    and public.profile_is_test((new_row ->> 'assigned_driver_id')::uuid) is distinct from coalesce((new_row ->> 'is_test')::boolean, false) then
    raise exception 'test and real accounts cannot be booked together';
  end if;

  if tg_table_name = 'job_offers' and tg_op <> 'DELETE'
    and public.profile_is_test((new_row ->> 'driver_id')::uuid) is distinct from public.job_is_test((new_row ->> 'job_id')::uuid) then
    raise exception 'test and real accounts cannot be booked together';
  end if;

  if tg_table_name = 'notifications' and tg_op = 'INSERT'
    and nullif(new_row ->> 'job_id', '') is not null
    and public.profile_is_test((new_row ->> 'profile_id')::uuid) is distinct from public.job_is_test((new_row ->> 'job_id')::uuid) then
    return null;
  end if;

  if tg_table_name = 'job_payments' and tg_op <> 'DELETE' then
    row_test := public.job_is_test((new_row ->> 'job_id')::uuid);
    if row_test and (new_row ->> 'stripe_livemode')::boolean is true then
      raise exception 'a test job cannot use a live Stripe payment';
    end if;
    if nullif(new_row ->> 'payment_intent_id', '') is not null and exists (
      select 1
      from public.job_payments other
      join public.jobs other_job on other_job.id = other.job_id
      where other.payment_intent_id = new_row ->> 'payment_intent_id'
        and other.job_id is distinct from (new_row ->> 'job_id')::uuid
        and other_job.is_test is distinct from row_test
    ) then
      raise exception 'that Stripe payment belongs to the other account lane';
    end if;
  end if;

  if tg_table_name = 'platform_settings' and public.actor_is_test() then
    raise exception 'test accounts cannot change Pickuply settings';
  end if;

  if auth.uid() is null or public.is_migration_session() or not public.actor_is_test() then
    return coalesce(new, old);
  end if;

  if tg_table_name in ('profiles', 'jobs') then
    row_test := coalesce(((case when tg_op = 'DELETE' then old_row else new_row end) ->> 'is_test')::boolean, false);
  elsif tg_table_name = 'drivers' then
    row_test := public.profile_is_test((((case when tg_op = 'DELETE' then old_row else new_row end) ->> 'profile_id'))::uuid);
  elsif tg_table_name in ('job_offers', 'ledger_entries', 'job_payments') then
    row_test := public.job_is_test((((case when tg_op = 'DELETE' then old_row else new_row end) ->> 'job_id'))::uuid);
  elsif tg_table_name = 'notifications' then
    row_test := public.profile_is_test((new_row ->> 'profile_id')::uuid);
  elsif tg_table_name = 'account_suspensions' then
    row_test := public.profile_is_test((((case when tg_op = 'DELETE' then old_row else new_row end) ->> 'profile_id'))::uuid);
  else
    row_test := true;
  end if;

  if not coalesce(row_test, false) then
    raise exception 'test accounts cannot change real account data';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.stamp_job_test_lane() from public, anon, authenticated, service_role;
revoke all on function public.guard_test_lane_write() from public, anon, authenticated, service_role;

drop trigger if exists jobs_b_lane_write on public.jobs;
create trigger jobs_b_lane_write
  before insert or update on public.jobs
  for each row execute function public.guard_test_lane_write();

drop trigger if exists profiles_lane_write on public.profiles;
create trigger profiles_lane_write
  before update or delete on public.profiles
  for each row execute function public.guard_test_lane_write();

drop trigger if exists drivers_lane_write on public.drivers;
create trigger drivers_lane_write
  before insert or update or delete on public.drivers
  for each row execute function public.guard_test_lane_write();

drop trigger if exists offers_lane_write on public.job_offers;
create trigger offers_lane_write
  before insert or update on public.job_offers
  for each row execute function public.guard_test_lane_write();

drop trigger if exists notifications_lane_write on public.notifications;
create trigger notifications_lane_write
  before insert on public.notifications
  for each row execute function public.guard_test_lane_write();

drop trigger if exists suspensions_lane_write on public.account_suspensions;
create trigger suspensions_lane_write
  before insert or update or delete on public.account_suspensions
  for each row execute function public.guard_test_lane_write();

drop trigger if exists ledger_lane_write on public.ledger_entries;
create trigger ledger_lane_write
  before insert or update or delete on public.ledger_entries
  for each row execute function public.guard_test_lane_write();

drop trigger if exists payments_lane_write on public.job_payments;
create trigger payments_lane_write
  before insert or update on public.job_payments
  for each row execute function public.guard_test_lane_write();

drop trigger if exists settings_lane_write on public.platform_settings;
create trigger settings_lane_write
  before update on public.platform_settings
  for each row execute function public.guard_test_lane_write();

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (public.is_admin() and public.test_lane_matches(is_test))
  );

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (
    id = auth.uid()
    or (public.is_admin() and public.test_lane_matches(is_test))
  )
  with check (
    id = auth.uid()
    or (public.is_admin() and public.test_lane_matches(is_test))
  );

drop policy if exists drivers_select_own on public.drivers;
create policy drivers_select_own on public.drivers
  for select to authenticated
  using (
    profile_id = auth.uid()
    or (public.is_admin() and public.test_lane_matches(public.profile_is_test(profile_id)))
  );

drop policy if exists drivers_update_own on public.drivers;
create policy drivers_update_own on public.drivers
  for update to authenticated
  using (
    profile_id = auth.uid()
    or (public.is_admin() and public.test_lane_matches(public.profile_is_test(profile_id)))
  )
  with check (
    profile_id = auth.uid()
    or (public.is_admin() and public.test_lane_matches(public.profile_is_test(profile_id)))
  );

drop policy if exists jobs_select_parties on public.jobs;
create policy jobs_select_parties on public.jobs
  for select to authenticated
  using (
    public.test_lane_matches(is_test)
    and (
      customer_id = auth.uid()
      or public.is_admin()
      or public.is_assigned_driver(id)
    )
  );

drop policy if exists jobs_insert_own on public.jobs;
create policy jobs_insert_own on public.jobs
  for insert to authenticated
  with check (
    (
      customer_id = auth.uid()
      and public.actor_is_test() = public.profile_is_test(customer_id)
    )
    or (public.is_admin() and public.test_lane_matches(public.profile_is_test(customer_id)))
  );

drop policy if exists jobs_admin_update on public.jobs;
create policy jobs_admin_update on public.jobs
  for update to authenticated
  using (public.is_admin() and public.test_lane_matches(is_test))
  with check (public.is_admin() and public.test_lane_matches(is_test));

drop policy if exists offers_select_parties on public.job_offers;
create policy offers_select_parties on public.job_offers
  for select to authenticated
  using (
    public.test_lane_matches(public.job_is_test(job_id))
    and (
      driver_id = auth.uid()
      or public.is_admin()
      or exists (
        select 1 from public.jobs
        where jobs.id = job_offers.job_id
          and jobs.customer_id = auth.uid()
      )
    )
  );

drop policy if exists ledger_read on public.ledger_entries;
create policy ledger_read on public.ledger_entries
  for select to authenticated
  using (
    driver_id = auth.uid()
    or (public.is_admin() and public.test_lane_matches(public.job_is_test(job_id)))
  );

drop policy if exists recovery_read on public.recovery_obligations;
create policy recovery_read on public.recovery_obligations
  for select to authenticated
  using (
    driver_id = auth.uid()
    or (public.is_admin() and public.test_lane_matches(public.profile_is_test(driver_id)))
  );

drop policy if exists bank_payout_read on public.driver_bank_payouts;
create policy bank_payout_read on public.driver_bank_payouts
  for select to authenticated
  using (
    driver_id = auth.uid()
    or (public.is_admin() and public.test_lane_matches(public.profile_is_test(driver_id)))
  );

drop policy if exists driver_connect_select_own on public.driver_connect_accounts;
create policy driver_connect_select_own on public.driver_connect_accounts
  for select to authenticated
  using (
    driver_id = auth.uid()
    or (public.is_admin() and public.test_lane_matches(public.profile_is_test(driver_id)))
  );

drop policy if exists help_requests_select on public.help_requests;
create policy help_requests_select on public.help_requests
  for select to authenticated
  using (
    profile_id = auth.uid()
    or (public.is_admin() and public.test_lane_matches(public.profile_is_test(profile_id)))
  );

drop policy if exists job_feed_signals_select on public.job_feed_signals;
create policy job_feed_signals_select on public.job_feed_signals
  for select to authenticated
  using (
    is_test = public.actor_is_test()
    and exists (
      select 1
      from public.drivers
      join public.profiles on profiles.id = drivers.profile_id
      where drivers.profile_id = auth.uid()
        and drivers.status <> 'removed'
        and not profiles.blocked
    )
  );

drop policy if exists funnel_events_own_read on public.funnel_events;
create policy funnel_events_own_read on public.funnel_events
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      public.is_admin()
      and (
        (user_id is null and not public.actor_is_test())
        or public.test_lane_matches(public.profile_is_test(user_id))
      )
    )
  );

create or replace function public.message_participant(target_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.message_threads threads
    left join public.jobs on jobs.id = threads.job_id
    left join public.profiles requester on requester.id = threads.requester_id
    where threads.id = target_thread
      and public.test_lane_matches(coalesce(jobs.is_test, requester.is_test, false))
      and (
        public.is_admin()
        or threads.requester_id = auth.uid()
        or threads.driver_id = auth.uid()
      )
  );
$$;

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
  if uid is null or public.account_is_suspended(uid) then
    return false;
  end if;
  select * into profile_row from public.profiles where id = uid;
  if not found or profile_row.blocked or profile_row.deleted_at is not null then
    return false;
  end if;
  if public.phone_is_restricted(profile_row.phone) then
    return false;
  end if;
  select * into driver_row from public.drivers where profile_id = uid;
  if not found or driver_row.status not in ('active', 'approved_new') or driver_row.driving_stopped_at is not null then
    return false;
  end if;
  select * into job_row from public.jobs where id = target_job;
  if not found or job_row.status <> 'open' or job_row.test_retired_at is not null then
    return false;
  end if;
  if job_row.is_test is distinct from profile_row.is_test then
    return false;
  end if;
  if job_row.customer_id = uid or public.account_is_suspended(job_row.customer_id) then
    return false;
  end if;
  if job_row.paused_at is not null and not (
    job_row.suspension_hold and not public.account_is_suspended(job_row.customer_id)
  ) then
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
  if uid is null or public.account_is_suspended(uid) then
    return;
  end if;
  select * into profile_row from public.profiles where profiles.id = uid;
  if not found or profile_row.blocked or profile_row.deleted_at is not null then
    return;
  end if;
  select * into driver_row from public.drivers where drivers.profile_id = uid;
  if not found or driver_row.status = 'removed' or driver_row.driving_stopped_at is not null then
    return;
  end if;
  return query
  select
    j.id, j.service, j.pieces, j.size, j.pickup_area, j.dropoff_area, j.distance_miles,
    j.stairs_pickup, j.stairs_dropoff, j.elevator, j.help_loading, j.preferred_date, j.time_window,
    j.pricing_method,
    case when j.pricing_method = 'fixed' then j.offer_cents else null end,
    case when j.pricing_method = 'range' then j.budget_min_cents else null end,
    case when j.pricing_method = 'range' then j.budget_max_cents else null end,
    case when j.pricing_method = 'quote' then j.driver_pay_cents else null end,
    case when j.pricing_method = 'quote' then j.quote_expires_at else null end,
    j.junk_load_size, j.service_level, j.required_vehicle, j.created_at,
    public.driver_home_miles(uid, j.pickup_area),
    public.feed_date_group(j.preferred_date),
    public.coverage_matches(uid, j.pickup_area)
  from public.jobs j
  where j.status = 'open'
    and j.is_test = profile_row.is_test
    and j.test_retired_at is null
    and (
      j.paused_at is null
      or (
        j.suspension_hold
        and not public.account_is_suspended(j.customer_id)
        and (j.quote_expires_at is null or j.quote_expires_at > now())
      )
    )
    and not public.account_is_suspended(j.customer_id)
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

create or replace function public.driver_job_feed()
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
  miles_from_you numeric
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
  select * into driver_row from public.drivers where profile_id = uid;
  if not found or driver_row.status = 'removed' then
    return;
  end if;
  return query
  select
    j.id, j.service, j.pieces, j.size, j.pickup_area, j.dropoff_area, j.distance_miles,
    j.stairs_pickup, j.stairs_dropoff, j.elevator, j.help_loading, j.preferred_date, j.time_window,
    j.pricing_method,
    case when j.pricing_method = 'fixed' then j.offer_cents else null end,
    case when j.pricing_method = 'range' then j.budget_min_cents else null end,
    case when j.pricing_method = 'range' then j.budget_max_cents else null end,
    case when j.pricing_method = 'quote' then j.driver_pay_cents else null end,
    case when j.pricing_method = 'quote' then j.quote_expires_at else null end,
    j.junk_load_size, j.service_level, j.required_vehicle, j.created_at,
    public.driver_home_miles(uid, j.pickup_area)
  from public.jobs j
  where j.status = 'open'
    and j.is_test = profile_row.is_test
    and j.test_retired_at is null
    and not exists (
      select 1 from public.customer_driver_blocks
      where customer_id = j.customer_id and driver_id = uid
    )
    and public.job_passes_filters(uid, j);
end;
$$;

create or replace function public.notify_drivers_of_open_job(job_row public.jobs)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  driver uuid;
  area text := left(coalesce(job_row.pickup_area, 'your area'), 80);
  waves boolean := public.waves_enabled();
begin
  if job_row.test_retired_at is not null then
    return;
  end if;
  for driver in
    select d.profile_id
    from public.drivers d
    join public.profiles p on p.id = d.profile_id
    where d.status in ('approved_new', 'active')
      and not p.blocked
      and p.is_test = job_row.is_test
      and p.test_retired_at is null
      and public.coverage_matches(d.profile_id, job_row.pickup_area)
      and (d.is_online or d.offline_job_alerts)
      and not exists (
        select 1 from public.customer_driver_blocks b
        where b.customer_id = job_row.customer_id and b.driver_id = d.profile_id
      )
      and (not waves or public.job_released_to_driver(d.profile_id, job_row))
  loop
    perform public.enqueue_notification(
      driver, job_row.id, 'new_job', 'New job nearby',
      'A new job is open in ' || area || '.',
      '/driver', 'new-job:' || job_row.id
    );
  end loop;
end;
$$;

revoke all on function public.notify_drivers_of_open_job(public.jobs) from public, anon, authenticated, service_role;

create or replace function public.note_job_feed_signal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'open' and new.paused_at is null and new.test_retired_at is null then
      delete from public.job_feed_signals where created_at < now() - interval '1 day';
      insert into public.job_feed_signals (is_test) values (new.is_test);
    end if;
  elsif new.status is distinct from old.status or new.paused_at is distinct from old.paused_at then
    if (new.status = 'open' or old.status = 'open') and new.test_retired_at is null then
      delete from public.job_feed_signals where created_at < now() - interval '1 day';
      insert into public.job_feed_signals (is_test) values (new.is_test);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.note_job_feed_signal() from public, anon, authenticated, service_role;

create or replace function public.drivers_covering_pickup(pickup_area text)
returns table (profile_id uuid, summary text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can list drivers for a pickup';
  end if;
  return query
  select drivers.profile_id, public.coverage_summary(drivers.profile_id)
  from public.drivers
  join public.profiles on profiles.id = drivers.profile_id
  where drivers.status in ('active', 'approved_new')
    and profiles.is_test = public.actor_is_test()
    and profiles.test_retired_at is null
    and public.coverage_matches(drivers.profile_id, pickup_area);
end;
$$;

create or replace function public.drivers_covering_pickup(pickup_area text, target_job uuid)
returns table (profile_id uuid, summary text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  job_test boolean;
begin
  if not public.is_admin() then
    raise exception 'only an admin can list drivers for a pickup';
  end if;
  select is_test into job_test from public.jobs where id = target_job;
  if not found then
    return;
  end if;
  if public.actor_is_test() and not job_test then
    return;
  end if;
  return query
  select drivers.profile_id, public.coverage_summary(drivers.profile_id)
  from public.drivers
  join public.profiles on profiles.id = drivers.profile_id
  where drivers.status in ('active', 'approved_new')
    and profiles.is_test = job_test
    and profiles.test_retired_at is null
    and public.coverage_matches(drivers.profile_id, pickup_area);
end;
$$;

revoke all on function public.drivers_covering_pickup(text, uuid) from public, anon, service_role;
grant execute on function public.drivers_covering_pickup(text, uuid) to authenticated;

create or replace function public.announcement_recipients(audience jsonb, purpose text)
returns table(profile_id uuid, suspended boolean)
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select
      coalesce(audience ->> 'kind', '') as kind,
      coalesce(audience ->> 'city', '') as city,
      coalesce((audience ->> 'onlineOnly')::boolean, false) as online_only,
      coalesce(array(select jsonb_array_elements_text(audience -> 'ids')), '{}') as ids
  ),
  people as (
    select
      profiles.id,
      profiles.role,
      profiles.deleted_at,
      profiles.is_test,
      profiles.test_retired_at,
      public.account_is_suspended(profiles.id) as suspended,
      drivers.status as driver_status,
      drivers.driving_stopped_at,
      drivers.is_online,
      drivers.license_url,
      drivers.insurance_url,
      drivers.training_completed_at,
      drivers.agreement_signed_at,
      coalesce((
        select count(*) from public.jobs
        where jobs.customer_id = profiles.id
          and jobs.status in ('assigned', 'en_route', 'arrived', 'item_check', 'in_transit', 'delivered')
      ), 0) as active_bookings,
      coalesce((
        select count(*) from public.jobs
        where jobs.customer_id = profiles.id
          and jobs.status in ('assigned', 'en_route', 'arrived', 'item_check', 'in_transit', 'delivered', 'completed')
      ), 0) as booked_jobs
    from public.profiles
    left join public.drivers on drivers.profile_id = profiles.id
  )
  select people.id, people.suspended
  from people
  cross join input
  where people.deleted_at is null
    and people.test_retired_at is null
    and people.is_test = case
      when current_setting('pickuply.announcement_test_lane', true) in ('true', 'false')
        then current_setting('pickuply.announcement_test_lane', true)::boolean
      else public.actor_is_test()
    end
    and people.role is distinct from 'admin'
    and (
      (input.kind in ('individual', 'selected') and people.id::text = any (input.ids))
      or (input.kind = 'customers' and people.role = 'customer')
      or (input.kind = 'active_customers' and people.active_bookings > 0)
      or (input.kind = 'never_booked' and people.role = 'customer' and people.booked_jobs = 0)
      or (
        input.kind = 'needs_documents'
        and people.driver_status is not null
        and people.driver_status <> 'removed'
        and people.driving_stopped_at is null
        and (
          people.license_url is null
          or people.insurance_url is null
          or people.training_completed_at is null
          or people.agreement_signed_at is null
        )
      )
      or (
        input.kind in ('drivers', 'online_drivers', 'city_drivers', 'all')
        and (
          (input.kind = 'all' and people.role = 'customer')
          or (
            people.driver_status in ('active', 'approved_new')
            and people.driving_stopped_at is null
            and (input.kind <> 'online_drivers' or people.is_online)
            and (
              input.kind <> 'city_drivers'
              or (
                exists (
                  select 1
                  from public.driver_feed_filters filters
                  cross join lateral unnest(filters.cities) as covered(city)
                  where filters.profile_id = people.id
                    and lower(btrim(covered.city)) = lower(btrim(input.city))
                )
                and (not input.online_only or people.is_online)
              )
            )
            and input.kind <> 'all'
          )
          or (
            input.kind = 'all'
            and people.driver_status in ('active', 'approved_new')
            and people.driving_stopped_at is null
          )
        )
      )
    );
$$;

create or replace function public.stamp_announcement_lane()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.audience_is_test := public.actor_is_test();
  return new;
end;
$$;

revoke all on function public.stamp_announcement_lane() from public, anon, authenticated, service_role;

drop trigger if exists announcements_stamp_lane on public.admin_announcements;
create trigger announcements_stamp_lane
  before insert on public.admin_announcements
  for each row execute function public.stamp_announcement_lane();

create or replace function public.execute_due_announcements()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.admin_announcements%rowtype;
  recipient record;
  preview jsonb;
  eligible integer;
  devices integer;
  handled integer := 0;
  recent integer;
  sms_state text;
  sms_after timestamptz;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not public.is_migration_session() then
    raise exception 'service role required';
  end if;
  for item in
    select * from public.admin_announcements
    where status = 'scheduled' and started_at is null and scheduled_for <= now()
    order by scheduled_for, id
    for update skip locked
  loop
    update public.admin_announcements set status = 'processing', started_at = now(), updated_at = now() where id = item.id;
    perform set_config('pickuply.announcement_test_lane', item.audience_is_test::text, true);
    preview := public.announcement_audience_preview(item.audience, item.purpose);
    eligible := coalesce((preview ->> 'eligible')::integer, 0);
    update public.admin_announcements
    set eligible_count = eligible, excluded_suspended = coalesce((preview ->> 'excludedSuspended')::integer, 0)
    where id = item.id;
    for recipient in
      select people.profile_id
      from public.announcement_recipients(item.audience, item.purpose) people
      where not people.suspended
        or (item.purpose = 'account_support' and item.audience ->> 'kind' in ('individual', 'selected'))
    loop
      recent := 0;
      if item.purpose is distinct from 'account_support' then
        select count(*) into recent
        from public.admin_announcement_deliveries deliveries
        join public.admin_announcements sent on sent.id = deliveries.announcement_id
        where deliveries.profile_id = recipient.profile_id
          and sent.purpose = 'promotional'
          and deliveries.attempted_at > now() - interval '24 hours'
          and (
            deliveries.in_app = 'sent'
            or deliveries.push = 'provider_accepted'
            or deliveries.sms in ('mocked', 'sent')
          );
      end if;
      if recent >= 3 then
        insert into public.admin_announcement_deliveries (
          announcement_id, profile_id, push_devices, in_app, push, sms, push_displayed
        ) values (
          item.id, recipient.profile_id, 0, 'skipped', 'skipped', 'skipped', false
        )
        on conflict do nothing;
        continue;
      end if;
      select count(*) into devices
      from public.push_subscriptions
      where profile_id = recipient.profile_id
        and expired_at is null
        and not exists (
          select 1 from public.notification_preferences prefs
          where prefs.profile_id = recipient.profile_id and prefs.push_enabled = false
        );
      sms_state := 'skipped';
      sms_after := null;
      if 'sms' = any (item.channels) then
        select state, send_after into sms_state, sms_after
        from public.announcement_sms_state(recipient.profile_id, item.purpose, now());
      end if;
      insert into public.admin_announcement_deliveries (
        announcement_id, profile_id, push_devices, in_app, push, sms, push_displayed, sms_after
      ) values (
        item.id,
        recipient.profile_id,
        case when 'push' = any (item.channels) and devices > 0 then devices else 0 end,
        case when 'in_app' = any (item.channels) then 'sent' else 'skipped' end,
        case when 'push' = any (item.channels) and devices > 0 then 'provider_accepted' else 'skipped' end,
        coalesce(sms_state, 'skipped'),
        false,
        sms_after
      )
      on conflict do nothing;
      if 'in_app' = any (item.channels) then
        insert into public.notifications (profile_id, kind, title, body, href, dedupe_key)
        values (recipient.profile_id, 'admin_announcement', item.title, item.body, item.href, 'announcement:' || item.id::text)
        on conflict (profile_id, dedupe_key) do nothing;
      end if;
    end loop;
    update public.admin_announcements
    set status = 'sent', finished_at = now(), updated_at = now()
    where id = item.id;
    handled := handled + 1;
  end loop;
  perform set_config('pickuply.announcement_test_lane', '', true);
  return handled;
end;
$$;

create or replace function public.admin_funnel(
  range_start date,
  range_end date,
  source_filter text,
  include_test boolean
)
returns table (event_name text, step text, sessions bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  show_test boolean := coalesce(include_test, false) and public.is_admin() and not public.actor_is_test();
begin
  if not public.is_admin() then
    raise exception 'only an admin can read the funnel';
  end if;
  return query
  select events.event_name, events.step, count(distinct events.session_id)
  from public.funnel_events as events
  where events.created_at >= range_start
    and events.created_at < range_end + 1
    and (nullif(source_filter, '') is null or events.source = source_filter)
    and (
      show_test
      or not exists (
        select 1 from public.profiles
        where profiles.id = events.user_id and profiles.is_test
      )
    )
  group by events.event_name, events.step;
end;
$$;

create or replace function public.admin_funnel(range_start date, range_end date, source_filter text)
returns table (event_name text, step text, sessions bigint)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.admin_funnel(range_start, range_end, source_filter, false);
$$;

revoke all on function public.admin_funnel(date, date, text, boolean) from public, anon, service_role;
grant execute on function public.admin_funnel(date, date, text, boolean) to authenticated;

create or replace function public.admin_open_threads(include_test boolean)
returns table (
  thread_id uuid,
  kind text,
  label text,
  unread integer,
  last_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lane boolean := public.actor_is_test();
  show_all boolean := coalesce(include_test, false) and public.is_admin() and not lane;
begin
  if not public.is_admin() then
    return;
  end if;

  return query
  select
    threads.id,
    threads.kind,
    case
      when threads.kind = 'support' then 'Support · ' || split_part(coalesce(profiles.full_name, 'Pickuply'), ' ', 1)
      else 'Job in ' || left(coalesce(jobs.pickup_area, 'the service area'), 80)
    end,
    (
      select count(*)::integer
      from public.messages
      where messages.thread_id = threads.id
        and messages.sender_id is distinct from auth.uid()
        and messages.created_at > coalesce(
          (
            select message_reads.last_read_at
            from public.message_reads
            where message_reads.thread_id = threads.id
              and message_reads.profile_id = auth.uid()
          ),
          '-infinity'::timestamptz
        )
    ),
    (
      select max(messages.created_at)
      from public.messages
      where messages.thread_id = threads.id
    )
  from public.message_threads threads
  left join public.jobs on jobs.id = threads.job_id
  left join public.profiles on profiles.id = threads.requester_id
  where (threads.closes_at is null or threads.closes_at > now())
    and (
      show_all
      or coalesce(jobs.is_test, profiles.is_test, false) = lane
    )
  order by 5 desc nulls last;
end;
$$;

create or replace function public.admin_open_threads()
returns table (
  thread_id uuid,
  kind text,
  label text,
  unread integer,
  last_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.admin_open_threads(false);
$$;

revoke all on function public.admin_open_threads(boolean) from public, anon, service_role;
grant execute on function public.admin_open_threads(boolean) to authenticated;

create or replace function public.admin_message_directory()
returns table (
  profile_id uuid,
  label text,
  person_role text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return;
  end if;
  return query
  select
    profiles.id,
    split_part(coalesce(profiles.full_name, 'Pickuply'), ' ', 1)
      || case when drivers.home_city is not null then ' · ' || drivers.home_city else '' end,
    case when drivers.profile_id is not null then 'driver' else profiles.role::text end
  from public.profiles
  left join public.drivers on drivers.profile_id = profiles.id
  where (profiles.role in ('customer', 'driver') or drivers.profile_id is not null)
    and profiles.is_test = public.actor_is_test()
    and profiles.test_retired_at is null
  order by 2;
end;
$$;

create or replace function public.ready_transfers()
returns table (
  entry_id uuid,
  amount_cents integer,
  driver_id uuid,
  stripe_account_id text,
  charge_id text
)
language sql
security definer
set search_path = public
as $$
  select
    ledger_entries.id,
    ledger_entries.amount_cents,
    ledger_entries.driver_id,
    driver_connect_accounts.stripe_account_id,
    job_payments.charge_id
  from public.ledger_entries
  join public.jobs on jobs.id = ledger_entries.job_id
  join public.driver_connect_accounts
    on driver_connect_accounts.driver_id = ledger_entries.driver_id
    and driver_connect_accounts.payouts_enabled
  join public.job_payments on job_payments.job_id = ledger_entries.job_id
  where ledger_entries.status = 'ready'
    and ledger_entries.amount_cents > 0
    and ledger_entries.stripe_transfer_id is null
    and job_payments.charge_id is not null
    and jobs.is_test = false
    and coalesce(job_payments.stripe_livemode, false) = false
    and not exists (
      select 1 from public.job_disputes
      where job_id = ledger_entries.job_id and payout_hold
    )
    and not exists (
      select 1 from public.card_disputes
      where job_id = ledger_entries.job_id and outcome is null
    );
$$;

create or replace function public.note_stripe_livemode(target_job uuid, live boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not public.is_migration_session() then
    raise exception 'service role required';
  end if;
  update public.job_payments
  set stripe_livemode = coalesce(live, false),
      updated_at = now()
  where job_id = target_job;
end;
$$;

revoke all on function public.note_stripe_livemode(uuid, boolean) from public, anon, authenticated;
grant execute on function public.note_stripe_livemode(uuid, boolean) to service_role;

create or replace function public.preview_test_data_cleanup()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() or public.actor_is_test() then
    raise exception 'only a real admin can preview test data cleanup';
  end if;
  return jsonb_build_object(
    'profiles', (select count(*) from public.profiles where is_test and test_retired_at is null),
    'jobs', (select count(*) from public.jobs where is_test and test_retired_at is null),
    'notifications', (
      select count(*) from public.notifications
      join public.profiles on profiles.id = notifications.profile_id
      where profiles.is_test
    ),
    'push_subscriptions', (
      select count(*) from public.push_subscriptions
      join public.profiles on profiles.id = push_subscriptions.profile_id
      where profiles.is_test
    ),
    'funnel_events', (
      select count(*) from public.funnel_events
      join public.profiles on profiles.id = funnel_events.user_id
      where profiles.is_test
    ),
    'ledger_kept', (
      select count(*) from public.ledger_entries
      join public.jobs on jobs.id = ledger_entries.job_id
      where jobs.is_test
    ),
    'payments_kept', (
      select count(*) from public.job_payments
      join public.jobs on jobs.id = job_payments.job_id
      where jobs.is_test
    ),
    'messages_kept', (
      select count(*)
      from public.messages
      join public.message_threads threads on threads.id = messages.thread_id
      left join public.jobs on jobs.id = threads.job_id
      left join public.profiles requester on requester.id = threads.requester_id
      where coalesce(jobs.is_test, requester.is_test, false)
    )
  );
end;
$$;

create or replace function public.cleanup_test_data(confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  preview jsonb;
  removed_notifications integer := 0;
  removed_push integer := 0;
  removed_funnel integer := 0;
  retired_jobs integer := 0;
  retired_profiles integer := 0;
begin
  if not public.is_admin() or public.actor_is_test() then
    raise exception 'only a real admin can clean up test data';
  end if;
  if confirmation is distinct from 'DELETE TEST DATA' then
    raise exception 'type DELETE TEST DATA to confirm';
  end if;
  preview := public.preview_test_data_cleanup();
  delete from public.notifications
  using public.profiles
  where notifications.profile_id = profiles.id
    and profiles.is_test;
  get diagnostics removed_notifications = row_count;
  delete from public.push_subscriptions
  using public.profiles
  where push_subscriptions.profile_id = profiles.id
    and profiles.is_test;
  get diagnostics removed_push = row_count;
  delete from public.funnel_events
  using public.profiles
  where funnel_events.user_id = profiles.id
    and profiles.is_test;
  get diagnostics removed_funnel = row_count;
  delete from public.job_feed_signals where is_test;
  update public.jobs
  set test_retired_at = now()
  where is_test and test_retired_at is null;
  get diagnostics retired_jobs = row_count;
  update public.profiles
  set test_retired_at = now()
  where is_test and test_retired_at is null;
  get diagnostics retired_profiles = row_count;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'cleanup_test_data',
    'profiles',
    null,
    preview || jsonb_build_object(
      'removed_notifications', removed_notifications,
      'removed_push', removed_push,
      'removed_funnel', removed_funnel,
      'retired_jobs', retired_jobs,
      'retired_profiles', retired_profiles
    )
  );
  return jsonb_build_object(
    'removed_notifications', removed_notifications,
    'removed_push', removed_push,
    'removed_funnel', removed_funnel,
    'retired_jobs', retired_jobs,
    'retired_profiles', retired_profiles,
    'ledger_kept', preview -> 'ledger_kept',
    'payments_kept', preview -> 'payments_kept',
    'messages_kept', preview -> 'messages_kept'
  );
end;
$$;

revoke all on function public.preview_test_data_cleanup() from public, anon, service_role;
revoke all on function public.cleanup_test_data(text) from public, anon, service_role;
grant execute on function public.preview_test_data_cleanup() to authenticated;
grant execute on function public.cleanup_test_data(text) to authenticated;

grant execute on function public.driver_browse_jobs() to authenticated;
grant execute on function public.driver_is_eligible_for_job(uuid) to authenticated;
