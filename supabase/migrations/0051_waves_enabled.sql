-- Waves stay off until an admin turns them on. Visibility uses the time a
-- request opened, not a cron. The five-active-offer cap applies either way.

alter table public.platform_settings
  add column waves_enabled boolean not null default false;

alter table public.drivers
  add column offline_job_alerts boolean not null default true;

create or replace function public.waves_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select waves_enabled from public.platform_settings where id = 1), false);
$$;

revoke all on function public.waves_enabled() from public, anon, authenticated, service_role;

create or replace function public.job_released_to_driver(driver uuid, job_row public.jobs)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  opened timestamptz;
  miles numeric;
  covered boolean;
  coverage_pool integer;
  near_pool integer;
  coverage_rank integer;
  near_rank integer;
  wave2_at timestamptz;
  wave3_at timestamptz;
begin
  if not public.waves_enabled() then
    return true;
  end if;
  if exists (
    select 1 from public.job_driver_invitations
    where job_id = job_row.id and driver_id = driver
  ) then
    return true;
  end if;

  opened := coalesce(
    (
      select min(events.created_at)
      from public.job_events events
      where events.job_id = job_row.id
        and events.type = 'status'
        and events.data->>'to' = 'open'
    ),
    job_row.created_at
  );
  covered := public.coverage_matches(driver, job_row.pickup_area);
  miles := public.driver_home_miles(driver, job_row.pickup_area);

  select count(*) into coverage_pool
  from public.drivers d
  join public.profiles p on p.id = d.profile_id
  where d.status <> 'removed'
    and not p.blocked
    and (d.is_online or d.offline_job_alerts)
    and public.coverage_matches(d.profile_id, job_row.pickup_area)
    and not exists (
      select 1 from public.customer_driver_blocks b
      where b.customer_id = job_row.customer_id and b.driver_id = d.profile_id
    );

  if covered then
    select count(*) + 1 into coverage_rank
    from public.drivers d
    join public.profiles p on p.id = d.profile_id
    where d.profile_id <> driver
      and d.status <> 'removed'
      and not p.blocked
      and public.coverage_matches(d.profile_id, job_row.pickup_area)
      and not exists (
        select 1 from public.customer_driver_blocks b
        where b.customer_id = job_row.customer_id and b.driver_id = d.profile_id
      )
      and coalesce(public.driver_home_miles(d.profile_id, job_row.pickup_area), 100000)
        < coalesce(miles, 100000);
    if coverage_rank <= 10 then
      return true;
    end if;
  end if;

  wave2_at := case when coverage_pool < 10 then opened else opened + interval '10 minutes' end;
  if now() < wave2_at then
    return false;
  end if;

  select count(*) into near_pool
  from public.drivers d
  join public.profiles p on p.id = d.profile_id
  where d.status <> 'removed'
    and not p.blocked
    and (d.is_online or d.offline_job_alerts)
    and coalesce(public.driver_home_miles(d.profile_id, job_row.pickup_area), 100000) <= 50
    and not exists (
      select 1 from public.customer_driver_blocks b
      where b.customer_id = job_row.customer_id and b.driver_id = d.profile_id
    );

  if coalesce(miles, 100000) <= 50 then
    select count(*) + 1 into near_rank
    from public.drivers d
    join public.profiles p on p.id = d.profile_id
    where d.profile_id <> driver
      and d.status <> 'removed'
      and not p.blocked
      and coalesce(public.driver_home_miles(d.profile_id, job_row.pickup_area), 100000) <= 50
      and coalesce(public.driver_home_miles(d.profile_id, job_row.pickup_area), 100000)
        < coalesce(miles, 100000)
      and not exists (
        select 1 from public.customer_driver_blocks b
        where b.customer_id = job_row.customer_id and b.driver_id = d.profile_id
      );
    if near_rank <= 30 then
      return true;
    end if;
  end if;

  wave3_at := case when near_pool < 30 then wave2_at else opened + interval '20 minutes' end;
  return now() >= wave3_at;
end;
$$;

revoke all on function public.job_released_to_driver(uuid, public.jobs) from public, anon, authenticated, service_role;

create or replace function public.job_passes_filters(driver uuid, job_row public.jobs)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  filt public.driver_feed_filters%rowtype;
begin
  if job_row.paused_at is not null then
    return false;
  end if;
  if public.waves_enabled() and not public.job_released_to_driver(driver, job_row) then
    return false;
  end if;
  select * into filt from public.driver_feed_filters where profile_id = driver;
  if not found then
    return true;
  end if;
  if cardinality(filt.services) > 0 and not job_row.service = any (filt.services) then
    return false;
  end if;
  if filt.vehicle_fit and job_row.required_vehicle is not null and not exists (
    select 1 from public.vehicles
    where driver_id = driver and type = job_row.required_vehicle
  ) then
    return false;
  end if;
  return true;
end;
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

create or replace function public.set_waves_enabled(enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can change settings';
  end if;
  update public.platform_settings
  set waves_enabled = coalesce(enabled, false),
      updated_at = now()
  where id = 1;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'set_waves_enabled',
    'platform_settings',
    null,
    jsonb_build_object('waves_enabled', coalesce(enabled, false))
  );
end;
$$;

revoke all on function public.set_waves_enabled(boolean) from public, anon, service_role;
grant execute on function public.set_waves_enabled(boolean) to authenticated;

create or replace function public.set_offline_job_alerts(enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  update public.drivers
  set offline_job_alerts = coalesce(enabled, true)
  where profile_id = uid;
  if not found then
    raise exception 'apply to drive before changing alerts';
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    uid,
    'set_offline_job_alerts',
    'driver',
    uid,
    jsonb_build_object('offline_job_alerts', coalesce(enabled, true))
  );
end;
$$;

revoke all on function public.set_offline_job_alerts(boolean) from public, anon, service_role;
grant execute on function public.set_offline_job_alerts(boolean) to authenticated;

create or replace function public.guard_active_offer_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_migration_session() then
    return new;
  end if;
  if tg_op = 'INSERT' and new.status = 'active' and (
    select count(*)
    from public.job_offers
    where driver_id = new.driver_id
      and status = 'active'
      and expires_at > now()
  ) >= 5 then
    raise exception 'you can have five active offers at a time';
  end if;
  return new;
end;
$$;

drop trigger if exists job_offers_active_cap on public.job_offers;
create trigger job_offers_active_cap
  before insert on public.job_offers
  for each row execute function public.guard_active_offer_cap();

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
  for driver in
    select d.profile_id
    from public.drivers d
    join public.profiles p on p.id = d.profile_id
    where d.status in ('approved_new', 'active')
      and not p.blocked
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

create or replace function public.notify_open_job_drivers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'open'
    and new.paused_at is null
    and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    perform public.notify_drivers_of_open_job(new);
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_notify_open_drivers on public.jobs;
create trigger jobs_notify_open_drivers
  after insert or update of status on public.jobs
  for each row execute function public.notify_open_job_drivers();
