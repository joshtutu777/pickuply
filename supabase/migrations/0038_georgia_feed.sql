-- Open jobs are visible across Georgia. Accepting still requires an active driver
-- and a matching vehicle. Legacy approved_new rows still need an invitation.
-- Local only until the owner applies this to the hosted database.

alter table public.drivers
  add column if not exists home_zip text;

create table public.driver_feed_filters (
  profile_id uuid primary key references public.drivers (profile_id) on delete cascade,
  cities text[] not null default '{}',
  zips text[] not null default '{}',
  radius_miles integer,
  services public.job_service[] not null default '{}',
  vehicle_fit boolean not null default false,
  constraint driver_feed_filters_radius check (radius_miles is null or radius_miles in (10, 25, 50, 100))
);

alter table public.driver_feed_filters enable row level security;

create policy driver_feed_filters_select on public.driver_feed_filters
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

revoke all on table public.driver_feed_filters from public, anon, service_role;
grant select on table public.driver_feed_filters to authenticated;

create or replace function public.area_zip(area text)
returns text
language sql
immutable
as $$
  select substring(coalesce(area, '') from '([0-9]{5})\s*$');
$$;

create or replace function public.guard_georgia_zip()
returns trigger
language plpgsql
as $$
declare
  pickup_zip text := public.area_zip(new.pickup_area);
  dropoff_zip text := public.area_zip(new.dropoff_area);
begin
  if pickup_zip is not null and not exists (
    select 1 from public.ga_zip_centroids where zip = pickup_zip
  ) then
    raise exception 'Pickuply currently serves Georgia ZIP codes only.';
  end if;
  if dropoff_zip is not null and not exists (
    select 1 from public.ga_zip_centroids where zip = dropoff_zip
  ) then
    raise exception 'Pickuply currently serves Georgia ZIP codes only.';
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_georgia_zip on public.jobs;
create trigger jobs_georgia_zip
  before insert or update of pickup_area, dropoff_area on public.jobs
  for each row execute function public.guard_georgia_zip();

create or replace function public.driver_home_miles(driver uuid, pickup_area text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select public.private_miles_between(home.lat, home.lng, pickup.lat, pickup.lng)
  from public.drivers d
  left join public.ga_zip_centroids home on home.zip = d.home_zip
  left join public.ga_zip_centroids pickup on pickup.zip = public.area_zip(pickup_area)
  where d.profile_id = driver;
$$;

revoke all on function public.driver_home_miles(uuid, text) from public, anon, service_role;
grant execute on function public.driver_home_miles(uuid, text) to authenticated;

create or replace function public.job_passes_filters(driver uuid, job_row public.jobs)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  filt public.driver_feed_filters%rowtype;
  miles numeric;
  pickup_zip text := public.area_zip(job_row.pickup_area);
begin
  select * into filt from public.driver_feed_filters where profile_id = driver;
  if not found then
    return true;
  end if;
  if cardinality(filt.cities) > 0 and not exists (
    select 1 from unnest(filt.cities) as city
    where job_row.pickup_area ilike '%' || city || '%'
  ) then
    return false;
  end if;
  if cardinality(filt.zips) > 0 and (pickup_zip is null or not pickup_zip = any (filt.zips)) then
    return false;
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
  if filt.radius_miles is not null then
    miles := public.driver_home_miles(driver, job_row.pickup_area);
    if miles is null or miles > filt.radius_miles then
      return false;
    end if;
  end if;
  return true;
end;
$$;

revoke all on function public.job_passes_filters(uuid, public.jobs) from public, anon, service_role;

create or replace function public.save_driver_feed_filters(
  cities text[],
  zips text[],
  radius integer,
  service_names text[],
  fit_vehicle boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  clean_cities text[] := '{}';
  clean_zips text[] := '{}';
  clean_services public.job_service[] := '{}';
  city text;
  zip text;
  service_name text;
begin
  if uid is null or not exists (select 1 from public.drivers where profile_id = uid) then
    raise exception 'sign in required';
  end if;
  if radius is not null and radius not in (10, 25, 50, 100) then
    raise exception 'choose a radius of 10, 25, 50, or 100 miles';
  end if;
  foreach city in array coalesce(cities, '{}') loop
    city := btrim(city);
    if city <> '' then
      clean_cities := array_append(clean_cities, city);
    end if;
  end loop;
  foreach zip in array coalesce(zips, '{}') loop
    zip := btrim(zip);
    if zip ~ '^[0-9]{5}$' then
      clean_zips := array_append(clean_zips, zip);
    elsif zip <> '' then
      raise exception 'enter 5-digit ZIP codes';
    end if;
  end loop;
  foreach service_name in array coalesce(service_names, '{}') loop
    clean_services := array_append(clean_services, service_name::public.job_service);
  end loop;
  if cardinality(clean_cities) = 0 and cardinality(clean_zips) = 0 and radius is null
    and cardinality(clean_services) = 0 and not coalesce(fit_vehicle, false) then
    delete from public.driver_feed_filters where profile_id = uid;
    return;
  end if;
  insert into public.driver_feed_filters (profile_id, cities, zips, radius_miles, services, vehicle_fit)
  values (uid, clean_cities, clean_zips, radius, clean_services, coalesce(fit_vehicle, false))
  on conflict (profile_id) do update
  set cities = excluded.cities,
      zips = excluded.zips,
      radius_miles = excluded.radius_miles,
      services = excluded.services,
      vehicle_fit = excluded.vehicle_fit;
end;
$$;

revoke all on function public.save_driver_feed_filters(text[], text[], integer, text[], boolean) from public, anon, service_role;
grant execute on function public.save_driver_feed_filters(text[], text[], integer, text[], boolean) to authenticated;

create or replace function public.clear_driver_feed_filters()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  delete from public.driver_feed_filters where profile_id = auth.uid();
end;
$$;

revoke all on function public.clear_driver_feed_filters() from public, anon, service_role;
grant execute on function public.clear_driver_feed_filters() to authenticated;

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
  if driver_row.status = 'approved_new' and not exists (
    select 1 from public.job_driver_invitations
    where job_id = job_row.id and driver_id = uid
  ) then
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.assert_driver_can_take_job(target_job uuid, action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  driver_row public.drivers%rowtype;
  job_row public.jobs%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into driver_row from public.drivers where profile_id = uid;
  if not found or driver_row.status not in ('active', 'approved_new') then
    raise exception 'Finish setup to accept jobs.';
  end if;
  if not driver_row.is_online then
    if action = 'offer' then
      raise exception 'go online before sending an offer';
    end if;
    raise exception 'go online before claiming a job';
  end if;
  select * into job_row from public.jobs where id = target_job;
  if found and job_row.required_vehicle is not null and not exists (
    select 1 from public.vehicles
    where driver_id = uid and type = job_row.required_vehicle
  ) then
    raise exception 'This job needs a different vehicle.';
  end if;
  if not public.driver_is_eligible_for_job(target_job) then
    if action = 'offer' then
      raise exception 'this driver cannot offer on this job';
    end if;
    raise exception 'this driver cannot claim this job';
  end if;
end;
$$;

revoke all on function public.assert_driver_can_take_job(uuid, text) from public, anon, service_role;
grant execute on function public.assert_driver_can_take_job(uuid, text) to authenticated;

create or replace function public.claim_job(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
begin
  perform public.assert_driver_can_take_job(target_job, 'claim');
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.status <> 'open' or job_row.pricing_method <> 'quote' then
    raise exception 'job already taken';
  end if;
  perform set_config('pickuply.job_claimed', 'yes', true);
  update public.jobs
  set
    status = 'assigned',
    assigned_driver_id = uid,
    payment_status = 'awaiting_payment',
    payment_due_at = public.payment_due_at()
  where id = target_job;
  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, uid, 'claimed', jsonb_build_object('to', 'assigned'));
end;
$function$;

create or replace function public.submit_offer(
  target_job uuid,
  kind text,
  earnings_cents integer,
  reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  breakdown jsonb;
  offer_kind public.offer_kind;
  outside boolean := false;
  offer_id uuid;
begin
  perform public.assert_driver_can_take_job(target_job, 'offer');
  update public.job_offers
  set status = 'expired'
  where job_id = target_job and driver_id = uid and status = 'active' and expires_at <= now();
  if exists (
    select 1 from public.job_offers
    where job_id = target_job and driver_id = uid and status = 'active'
  ) then
    raise exception 'withdraw your current offer before sending another';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.status <> 'open' or job_row.pricing_method = 'quote' then
    raise exception 'offers are only allowed on open fixed or range jobs';
  end if;
  if job_row.pricing_method = 'fixed' and kind = 'accept' then
    breakdown := public.price_breakdown('accept', job_row.offer_cents);
    offer_kind := 'accept';
  else
    breakdown := public.price_breakdown('forward', earnings_cents);
    if job_row.pricing_method = 'fixed' then
      if (breakdown->>'customer_total_cents')::integer = job_row.offer_cents then
        raise exception 'accept the posted price instead of countering with the same total';
      end if;
      offer_kind := 'counter';
      outside := true;
    elsif (breakdown->>'customer_total_cents')::integer
      between job_row.budget_min_cents and job_row.budget_max_cents then
      offer_kind := 'offer';
    else
      offer_kind := 'counter';
      outside := true;
    end if;
  end if;
  if offer_kind = 'counter' and length(btrim(coalesce(reason, ''))) < 3 then
    raise exception 'a counteroffer needs a reason';
  end if;
  perform set_config('pickuply.offer_priced', 'yes', true);
  insert into public.job_offers (
    job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents,
    customer_total_cents, reason, outside_range, status, expires_at
  ) values (
    target_job, uid, offer_kind,
    (breakdown->>'driver_earnings_cents')::integer,
    (breakdown->>'platform_fee_cents')::integer,
    (breakdown->>'service_fee_cents')::integer,
    (breakdown->>'customer_total_cents')::integer,
    nullif(btrim(coalesce(reason, '')), ''),
    outside, 'active', now() + interval '2 hours'
  )
  returning id into offer_id;
  return offer_id;
end;
$function$;

drop function public.driver_job_feed();

create function public.driver_job_feed()
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
    public.driver_home_miles(uid, j.pickup_area)
  from public.jobs j
  where j.status = 'open'
    and not exists (
      select 1 from public.customer_driver_blocks
      where customer_id = j.customer_id and driver_id = uid
    )
    and public.job_passes_filters(uid, j);
end;
$$;

revoke all on function public.driver_job_feed() from public, anon, service_role;
grant execute on function public.driver_job_feed() to authenticated;

-- A driver can edit vehicle details after approval. They cannot change the approved flag.
create or replace function public.guard_vehicles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.approved is distinct from old.approved then
    if not public.is_migration_session() then
      if not public.is_admin()
        or coalesce(current_setting('pickuply.vehicle_approval', true), '') <> 'yes' then
        raise exception 'only an admin can approve a vehicle';
      end if;
      insert into public.audit_log (actor_id, action, target_type, target_id, data)
      values (
        auth.uid(),
        'approve_vehicle',
        'vehicle',
        new.id,
        jsonb_build_object('driver_id', new.driver_id, 'approved', new.approved)
      );
    end if;
  end if;

  if public.is_admin() or public.is_migration_session() then
    return new;
  end if;
  if new.driver_id is distinct from auth.uid() then
    raise exception 'drivers can only manage their own vehicles';
  end if;
  if tg_op = 'UPDATE' and old.approved and new.approved then
    return new;
  end if;
  if new.approved then
    raise exception 'only an admin can approve a vehicle';
  end if;
  if tg_op = 'UPDATE' and old.approved and not new.approved then
    raise exception 'only an admin can change vehicle approval';
  end if;
  return new;
end;
$$;

create or replace function public.submit_quick_application(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  applicant_name text;
  zone uuid;
  existing public.drivers%rowtype;
  driver_exists boolean := false;
  zip_value text := nullif(btrim(coalesce(payload->>'home_zip', '')), '');
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  applicant_name := btrim(coalesce(payload->>'full_name', ''));
  if applicant_name !~ '^[A-Za-z][A-Za-z .''-]{1,79}$' then
    raise exception 'enter your full name';
  end if;
  if coalesce(payload->>'contact_ok', '') <> 'true' then
    raise exception 'agree to be contacted about this application';
  end if;
  zone := (payload->>'zone_id')::uuid;
  if not exists (select 1 from public.zones where id = zone and active) then
    raise exception 'choose a service area';
  end if;
  if length(btrim(coalesce(payload->>'home_city', ''))) < 2 then
    raise exception 'enter your home city';
  end if;
  if zip_value is not null and not exists (select 1 from public.ga_zip_centroids where zip = zip_value) then
    raise exception 'Enter a Georgia home ZIP code.';
  end if;
  if payload->>'service_level' not in ('light', 'full') then
    raise exception 'choose light load or full service';
  end if;
  if payload->>'vehicle_type' not in ('car', 'suv', 'pickup', 'van', 'box_truck', 'trailer') then
    raise exception 'choose a vehicle type';
  end if;
  if coalesce(payload->>'photo_path', '') !~ ('^' || uid::text || '/profile\.(jpg|jpeg|png|webp)$') then
    raise exception 'upload a profile photo';
  end if;
  if coalesce(payload->>'license_path', '') !~ ('^' || uid::text || '/license\.(jpg|jpeg|png|webp)$') then
    raise exception 'upload a photo of your driver license';
  end if;
  if (payload->>'license_expires')::date < current_date then
    raise exception 'your license expiration must be in the future';
  end if;
  select * into existing from public.drivers where profile_id = uid;
  driver_exists := found;
  if driver_exists and existing.status in ('active', 'approved_new', 'paused') then
    raise exception 'this driver account is already reviewed';
  end if;
  update public.profiles
  set full_name = applicant_name, photo_url = payload->>'photo_path'
  where id = uid;
  perform set_config('pickuply.driver_application', 'yes', true);
  if not driver_exists then
    insert into public.drivers (
      profile_id, status, zone_id, home_city, home_zip, max_distance_miles, service_level,
      services, license_url, license_expires, checklist_required, contact_consent_at,
      review_note, is_online
    ) values (
      uid, 'pending_review', zone, btrim(payload->>'home_city'), zip_value, 25,
      (payload->>'service_level')::public.service_level, '{}',
      payload->>'license_path', (payload->>'license_expires')::date,
      true, now(), null, false
    );
  else
    update public.drivers
    set
      status = 'pending_review',
      zone_id = zone,
      home_city = btrim(payload->>'home_city'),
      home_zip = zip_value,
      service_level = (payload->>'service_level')::public.service_level,
      license_url = payload->>'license_path',
      license_expires = (payload->>'license_expires')::date,
      checklist_required = true,
      contact_consent_at = now(),
      review_note = null,
      is_online = false
    where profile_id = uid;
  end if;
  if not exists (select 1 from public.vehicles where driver_id = uid) then
    insert into public.vehicles (driver_id, type, approved)
    values (uid, (payload->>'vehicle_type')::public.vehicle_type, false);
  else
    update public.vehicles
    set type = (payload->>'vehicle_type')::public.vehicle_type
    where id = (
      select id from public.vehicles where driver_id = uid order by created_at desc limit 1
    );
  end if;
end;
$$;

create or replace function public.notify_on_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  area text := left(coalesce(new.pickup_area, 'your area'), 80);
  driver uuid;
  due text;
begin
  if tg_op = 'INSERT' then
    perform public.enqueue_notification(
      new.customer_id, new.id, 'request_received', 'Request received',
      'We have your request in ' || area || '.',
      '/jobs/' || new.id, 'request-received:' || new.id
    );
    perform public.notify_admins(
      new.id, 'new_request', 'New request',
      'New request in ' || area || '.',
      '/admin/requests/' || new.id, 'new-request:' || new.id
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'quoted' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'quote_ready', 'Your quote is ready',
        'A price is ready for your request in ' || area || '.',
        '/jobs/' || new.id, 'quote-ready:' || new.id
      );
    elsif new.status = 'open' then
      for driver in
        select drivers.profile_id
        from public.drivers
        join public.profiles on profiles.id = drivers.profile_id
        where drivers.is_online
          and drivers.status in ('approved_new', 'active')
          and not profiles.blocked
          and public.job_passes_filters(drivers.profile_id, new)
          and not exists (
            select 1 from public.customer_driver_blocks
            where customer_id = new.customer_id and driver_id = drivers.profile_id
          )
      loop
        perform public.enqueue_notification(
          driver, new.id, 'new_job', 'New job nearby',
          'A new job is open in ' || area || '.',
          '/driver', 'new-job:' || new.id
        );
      end loop;
    elsif new.status = 'assigned' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'driver_confirmed', 'Driver confirmed',
        'A driver is confirmed for your request in ' || area || '.',
        '/jobs/' || new.id, 'driver-confirmed:' || new.id
      );
      if new.assigned_driver_id is not null then
        perform public.enqueue_notification(
          new.assigned_driver_id, new.id, 'assigned', 'You are assigned',
          'The customer chose you for a job in ' || area || '.',
          '/driver/jobs/' || new.id, 'assigned:' || new.id
        );
      end if;
      if new.payment_status = 'awaiting_payment' then
        due := case
          when new.payment_due_at is null then 'before the driver can start'
          else to_char(new.payment_due_at at time zone 'America/New_York', 'Mon DD, HH12:MI AM') || ' ET'
        end;
        perform public.enqueue_notification(
          new.customer_id, new.id, 'payment_needed', 'Payment needed',
          'Payment is needed ' || due || ' for the job in ' || area || '.',
          '/jobs/' || new.id, 'payment-needed:' || new.id
        );
      end if;
    elsif new.status = 'en_route' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'en_route', 'Driver is on the way',
        'Your driver is heading to the pickup in ' || area || '.',
        '/jobs/' || new.id, 'en-route:' || new.id
      );
    elsif new.status = 'arrived' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'arrived', 'Driver arrived',
        'Your driver arrived for the job in ' || area || '.',
        '/jobs/' || new.id, 'arrived:' || new.id
      );
    elsif new.status = 'item_check' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'item_check', 'Item check',
        'Your driver is checking the item in ' || area || '.',
        '/jobs/' || new.id, 'item-check:' || new.id
      );
    elsif new.status = 'in_transit' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'picked_up',
        case when new.service = 'junk' then 'Load picked up' else 'Item picked up' end,
        case
          when new.service = 'junk' then 'The load was picked up in ' || area || '.'
          else 'Your item was picked up in ' || area || '.'
        end,
        '/jobs/' || new.id, 'picked-up:' || new.id
      );
    elsif new.status = 'delivered' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'delivered',
        case when new.service = 'junk' then 'Hauled away' else 'Delivered' end,
        case
          when new.service = 'junk' then 'The load was hauled away from ' || area || '.'
          else 'Your item was delivered in ' || area || '.'
        end,
        '/jobs/' || new.id, 'delivered:' || new.id
      );
    elsif new.status = 'completed' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'completed', 'Completed',
        'Your job in ' || area || ' is complete.',
        '/jobs/' || new.id, 'completed:' || new.id
      );
    elsif new.status = 'cancelled' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'cancelled', 'Cancelled',
        'The job in ' || area || ' was cancelled.',
        '/jobs/' || new.id, 'cancelled:' || new.id
      );
      if new.assigned_driver_id is not null then
        perform public.enqueue_notification(
          new.assigned_driver_id, new.id, 'cancelled', 'Job cancelled',
          'The job in ' || area || ' was cancelled.',
          '/driver/jobs/' || new.id, 'cancelled:' || new.id
        );
      end if;
    elsif new.status = 'disputed' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'disputed', 'Problem reported',
        'A problem was reported on the job in ' || area || '.',
        '/jobs/' || new.id, 'disputed:' || new.id
      );
      if new.assigned_driver_id is not null then
        perform public.enqueue_notification(
          new.assigned_driver_id, new.id, 'disputed', 'Problem reported',
          'A problem was reported on the job in ' || area || '.',
          '/driver/jobs/' || new.id, 'disputed:' || new.id
        );
      end if;
      perform public.notify_admins(
        new.id, 'disputed', 'Problem reported',
        'A problem was reported on a job in ' || area || '.',
        '/admin/requests/' || new.id, 'disputed:' || new.id
      );
    end if;
  end if;

  if new.payment_status is distinct from old.payment_status
    and new.payment_status in ('authorized', 'paid', 'captured') then
    perform public.enqueue_notification(
      new.customer_id, new.id, 'payment_confirmed', 'Payment confirmed',
      'Payment is confirmed for the job in ' || area || '.',
      '/jobs/' || new.id, 'payment-confirmed:' || new.id
    );
    if new.assigned_driver_id is not null then
      perform public.enqueue_notification(
        new.assigned_driver_id, new.id, 'payment_confirmed', 'Payment confirmed',
        'Payment is confirmed. You can start the job in ' || area || '.',
        '/driver/jobs/' || new.id, 'payment-confirmed:' || new.id
      );
    end if;
  end if;

  return new;
end;
$$;


