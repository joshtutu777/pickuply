-- Areas I cover: cities, ZIP codes, and a radius are one preference.
-- A job matches when the pickup hits any of them. Show all jobs does not change alerts.
-- Distances for an unassigned driver use ZIP centroids, rounded to the nearest mile.

alter table public.zones
  add column if not exists center_lat double precision,
  add column if not exists center_lng double precision;

update public.zones
set center_lat = centroid.lat, center_lng = centroid.lng
from public.ga_zip_centroids centroid
where zones.slug = 'west_metro' and centroid.zip = '30060' and zones.center_lat is null;

update public.zones
set center_lat = centroid.lat, center_lng = centroid.lng
from public.ga_zip_centroids centroid
where zones.slug = 'east_gwinnett' and centroid.zip = '30043' and zones.center_lat is null;

alter table public.driver_feed_filters
  add column if not exists show_all boolean not null default false,
  add column if not exists radius_zip text;

alter table public.driver_feed_filters
  drop constraint if exists driver_feed_filters_radius_zip;

alter table public.driver_feed_filters
  add constraint driver_feed_filters_radius_zip
  check (radius_zip is null or radius_zip ~ '^[0-9]{5}$');

-- Nearest mile from the driver's home ZIP (or zone center) to the pickup ZIP centroid.
create or replace function public.driver_home_miles(driver uuid, pickup_area text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(public.private_miles_between(
    coalesce(home.lat, zone_row.center_lat),
    coalesce(home.lng, zone_row.center_lng),
    pickup.lat,
    pickup.lng
  ), 0)
  from public.drivers d
  left join public.zones zone_row on zone_row.id = d.zone_id
  left join public.ga_zip_centroids home on home.zip = d.home_zip
  left join public.ga_zip_centroids pickup on pickup.zip = public.area_zip(pickup_area)
  where d.profile_id = driver;
$$;

revoke all on function public.driver_home_miles(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.coverage_radius_miles(driver uuid, pickup_area text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(public.private_miles_between(
    coalesce(origin.lat, home.lat, zone_row.center_lat),
    coalesce(origin.lng, home.lng, zone_row.center_lng),
    pickup.lat,
    pickup.lng
  ), 0)
  from public.drivers d
  left join public.driver_feed_filters filt on filt.profile_id = d.profile_id
  left join public.zones zone_row on zone_row.id = d.zone_id
  left join public.ga_zip_centroids home on home.zip = d.home_zip
  left join public.ga_zip_centroids origin on origin.zip = filt.radius_zip
  left join public.ga_zip_centroids pickup on pickup.zip = public.area_zip(pickup_area)
  where d.profile_id = driver;
$$;

revoke all on function public.coverage_radius_miles(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.coverage_matches(driver uuid, pickup_area text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  filt public.driver_feed_filters%rowtype;
  pickup_zip text := public.area_zip(pickup_area);
  pickup_city text;
  miles numeric;
begin
  select * into filt from public.driver_feed_filters where profile_id = driver;
  if not found then
    return false;
  end if;
  select city into pickup_city from public.ga_zip_centroids where zip = pickup_zip;
  if exists (
    select 1 from unnest(filt.cities) as city
    where btrim(city) <> ''
      and (
        pickup_area ilike '%' || btrim(city) || '%'
        or coalesce(pickup_city, '') ilike btrim(city)
      )
  ) then
    return true;
  end if;
  if pickup_zip is not null and pickup_zip = any (filt.zips) then
    return true;
  end if;
  if filt.radius_miles is not null then
    miles := public.coverage_radius_miles(driver, pickup_area);
    if miles is not null and miles <= filt.radius_miles then
      return true;
    end if;
  end if;
  return false;
end;
$$;

revoke all on function public.coverage_matches(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.coverage_summary(target uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  filt public.driver_feed_filters%rowtype;
  places text;
begin
  select * into filt from public.driver_feed_filters where profile_id = target;
  if not found then
    return '';
  end if;
  select string_agg(place, ', ' order by place) into places
  from (
    select btrim(city) as place from unnest(filt.cities) as city where btrim(city) <> ''
    union all
    select btrim(zip) from unnest(filt.zips) as zip where btrim(zip) <> ''
  ) listed;
  places := coalesce(places, '');
  if filt.radius_miles is not null and places = '' then
    return 'Within ' || filt.radius_miles || ' mi';
  end if;
  if filt.radius_miles is not null then
    return places || ' +' || filt.radius_miles || ' mi';
  end if;
  return places;
end;
$$;

revoke all on function public.coverage_summary(uuid) from public, anon, service_role;
grant execute on function public.coverage_summary(uuid) to authenticated;

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
  where drivers.status in ('active', 'approved_new')
    and public.coverage_matches(drivers.profile_id, pickup_area);
end;
$$;

revoke all on function public.drivers_covering_pickup(text) from public, anon, service_role;
grant execute on function public.drivers_covering_pickup(text) to authenticated;

create or replace function public.apply_driver_coverage(
  target uuid,
  cities text[],
  zips text[],
  radius integer,
  radius_from_zip text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_cities text[] := '{}';
  clean_zips text[] := '{}';
  city_name text;
  zip_code text;
  canonical text;
  origin text := nullif(btrim(coalesce(radius_from_zip, '')), '');
begin
  if radius is not null and radius not in (10, 25, 50, 100) then
    raise exception 'choose a radius of 10, 25, 50, or 100 miles';
  end if;
  foreach city_name in array coalesce(cities, '{}') loop
    city_name := btrim(city_name);
    if city_name = '' then
      continue;
    end if;
    select centroids.city into canonical
    from public.ga_zip_centroids centroids
    where centroids.city ilike city_name
    limit 1;
    if canonical is null then
      raise exception 'choose a Georgia city';
    end if;
    if not canonical = any (clean_cities) then
      clean_cities := array_append(clean_cities, canonical);
    end if;
  end loop;
  foreach zip_code in array coalesce(zips, '{}') loop
    zip_code := btrim(zip_code);
    if zip_code = '' then
      continue;
    end if;
    if zip_code !~ '^[0-9]{5}$' or not exists (
      select 1 from public.ga_zip_centroids centroids where centroids.zip = zip_code
    ) then
      raise exception 'Enter a Georgia ZIP code.';
    end if;
    if not zip_code = any (clean_zips) then
      clean_zips := array_append(clean_zips, zip_code);
    end if;
  end loop;
  if origin is not null and (
    origin !~ '^[0-9]{5}$'
    or not exists (select 1 from public.ga_zip_centroids where ga_zip_centroids.zip = origin)
  ) then
    raise exception 'Enter a Georgia ZIP code.';
  end if;
  if origin is not null and radius is null then
    raise exception 'choose a radius of 10, 25, 50, or 100 miles';
  end if;
  if cardinality(clean_cities) = 0 and cardinality(clean_zips) = 0 and radius is null then
    raise exception 'choose at least one area you cover';
  end if;
  insert into public.driver_feed_filters (profile_id, cities, zips, radius_miles, radius_zip)
  values (target, clean_cities, clean_zips, radius, origin)
  on conflict (profile_id) do update
  set cities = excluded.cities,
      zips = excluded.zips,
      radius_miles = excluded.radius_miles,
      radius_zip = excluded.radius_zip;
end;
$$;

revoke all on function public.apply_driver_coverage(uuid, text[], text[], integer, text) from public, anon, authenticated, service_role;

create or replace function public.save_driver_coverage(
  cities text[],
  zips text[],
  radius integer,
  radius_from_zip text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not exists (select 1 from public.drivers where profile_id = uid) then
    raise exception 'sign in required';
  end if;
  perform public.apply_driver_coverage(uid, cities, zips, radius, radius_from_zip);
end;
$$;

revoke all on function public.save_driver_coverage(text[], text[], integer, text) from public, anon, service_role;
grant execute on function public.save_driver_coverage(text[], text[], integer, text) to authenticated;

create or replace function public.set_show_all_jobs(enabled boolean)
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
  update public.driver_feed_filters
  set show_all = coalesce(enabled, false)
  where profile_id = uid;
  if not found then
    raise exception 'choose at least one area you cover';
  end if;
end;
$$;

revoke all on function public.set_show_all_jobs(boolean) from public, anon, service_role;
grant execute on function public.set_show_all_jobs(boolean) to authenticated;

create or replace function public.save_driver_feed_options(service_names text[], fit_vehicle boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  clean_services public.job_service[] := '{}';
  service_name text;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  foreach service_name in array coalesce(service_names, '{}') loop
    if btrim(service_name) <> '' then
      clean_services := array_append(clean_services, btrim(service_name)::public.job_service);
    end if;
  end loop;
  update public.driver_feed_filters
  set services = clean_services,
      vehicle_fit = coalesce(fit_vehicle, false)
  where profile_id = uid;
  if not found then
    raise exception 'choose at least one area you cover';
  end if;
end;
$$;

revoke all on function public.save_driver_feed_options(text[], boolean) from public, anon, service_role;
grant execute on function public.save_driver_feed_options(text[], boolean) to authenticated;

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
  select * into filt from public.driver_feed_filters where profile_id = driver;
  if not found then
    return true;
  end if;
  if not filt.show_all and not public.coverage_matches(driver, job_row.pickup_area) then
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
  return true;
end;
$$;

revoke all on function public.job_passes_filters(uuid, public.jobs) from public, anon, authenticated, service_role;

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
  if payload ? 'coverage' then
    perform public.apply_driver_coverage(
      uid,
      coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(payload->'coverage'->'cities', '[]'::jsonb))), '{}'::text[]),
      coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(payload->'coverage'->'zips', '[]'::jsonb))), '{}'::text[]),
      nullif(payload->'coverage'->>'radius', '')::integer,
      payload->'coverage'->>'radius_zip'
    );
  else
    perform public.apply_driver_coverage(uid, '{}', '{}', 25, null);
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
          and public.coverage_matches(drivers.profile_id, new.pickup_area)
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

create or replace function public.backfill_missing_coverage()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  with inserted as (
    insert into public.driver_feed_filters (profile_id, radius_miles)
    select drivers.profile_id, 25
    from public.drivers
    where not exists (
      select 1 from public.driver_feed_filters filt where filt.profile_id = drivers.profile_id
    )
    returning profile_id
  ),
  audited as (
    insert into public.audit_log (actor_id, action, target_type, target_id, data)
    select
      null,
      'backfill_coverage',
      'driver',
      profile_id,
      jsonb_build_object('radius_miles', 25, 'origin', 'home_zip_or_zone_center')
    from inserted
    returning 1
  )
  select count(*)::integer into inserted_count from audited;
  return coalesce(inserted_count, 0);
end;
$$;

revoke all on function public.backfill_missing_coverage() from public, anon, authenticated, service_role;

select public.backfill_missing_coverage();
