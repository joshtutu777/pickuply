-- Areas I cover: OR matching, show-all, alerts, claim outside coverage, admin filter, centroid miles.

begin;

set local search_path to public, extensions;

select plan(17);

do $$
declare
  sch text;
begin
  for sch in
    select n.nspname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'ok'
  loop
    execute format('grant usage on schema %I to anon, authenticated, service_role', sch);
    execute format(
      'grant execute on all functions in schema %I to anon, authenticated, service_role',
      sch
    );
  end loop;
end $$;

create or replace function pg_temp.as_user(uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text,
    true
  );
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.make_user(uid uuid, email text)
returns void
language plpgsql
as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    email, 'test-hash', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now(), uid::text, '', uid::text || '-email', uid::text || '-recovery'
  );
end;
$$;

select pg_temp.make_user('a4100000-0000-4000-8000-000000000001', 'cover-driver@pickuply.test');
select pg_temp.make_user('a4100000-0000-4000-8000-000000000002', 'cover-other@pickuply.test');
select pg_temp.make_user('a4100000-0000-4000-8000-000000000003', 'cover-admin@pickuply.test');
select pg_temp.make_user('a4100000-0000-4000-8000-000000000004', 'cover-backfill@pickuply.test');
update public.profiles set role = 'admin', full_name = 'Cover Admin' where id = 'a4100000-0000-4000-8000-000000000003';

select set_config('pickuply.quote_accepted', 'yes', true);
select pg_temp.as_user('a4100000-0000-4000-8000-000000000001');
select lives_ok(
  $$select public.submit_quick_application(jsonb_build_object(
    'full_name', 'Cover Driver',
    'home_city', 'Austell',
    'home_zip', '30106',
    'zone_id', (select id from public.zones where slug = 'west_metro'),
    'service_level', 'light',
    'vehicle_type', 'pickup',
    'photo_path', 'a4100000-0000-4000-8000-000000000001/profile.jpg',
    'license_path', 'a4100000-0000-4000-8000-000000000001/license.jpg',
    'license_expires', '2027-12-31',
    'contact_ok', 'true',
    'terms_ok', 'true',
    'coverage', jsonb_build_object(
      'cities', jsonb_build_array('Smyrna', 'Savannah'),
      'zips', '[]'::jsonb,
      'radius', 10,
      'radius_zip', null
    )
  ))$$,
  'signup saves two cities and a radius'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select set_config('role', 'postgres', true);

select is(
  public.coverage_summary('a4100000-0000-4000-8000-000000000001'),
  'Savannah, Smyrna +10 mi',
  'saved coverage lists both cities and the radius'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
  item_value_cents, stairs_pickup, stairs_dropoff, elevator, help_loading, preferred_date,
  pricing_method, service_level, required_vehicle
) values
  (
    'a4100000-0000-4000-8000-000000000010',
    'a4100000-0000-4000-8000-000000000003',
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell, 30106', 'Smyrna, 30080', 'Near desk', 1, 'medium',
    0, 0, 0, false, false, 'asap', 'quote', 'light', 'pickup'
  ),
  (
    'a4100000-0000-4000-8000-000000000011',
    'a4100000-0000-4000-8000-000000000003',
    'delivery', 'open', (select id from public.zones where slug = 'east_gwinnett'),
    'Savannah, 31401', 'Savannah, 31401', 'Far desk', 1, 'medium',
    0, 0, 0, false, false, 'asap', 'quote', 'light', 'pickup'
  ),
  (
    'a4100000-0000-4000-8000-000000000012',
    'a4100000-0000-4000-8000-000000000003',
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Alpharetta, 30004', 'Alpharetta, 30004', 'North desk', 1, 'medium',
    0, 0, 0, false, false, 'asap', 'quote', 'light', 'pickup'
  );

select pg_temp.as_user('a4100000-0000-4000-8000-000000000001');
select is(
  (
    select count(*)::int from public.driver_job_feed()
    where id in (
      'a4100000-0000-4000-8000-000000000010',
      'a4100000-0000-4000-8000-000000000011',
      'a4100000-0000-4000-8000-000000000012'
    )
  ),
  2,
  'the feed shows a radius match and a city match'
);
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'a4100000-0000-4000-8000-000000000012'),
  0,
  'a pickup outside the cities and radius stays hidden'
);

select lives_ok($$select public.set_show_all_jobs(true)$$, 'show all Georgia jobs can be turned on');
select is(
  (select show_all from public.driver_feed_filters where profile_id = 'a4100000-0000-4000-8000-000000000001'),
  true,
  'show all Georgia jobs is remembered'
);
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'a4100000-0000-4000-8000-000000000012'),
  1,
  'show all Georgia jobs reveals the pickup outside coverage'
);
select lives_ok($$select public.set_show_all_jobs(false)$$, 'show all Georgia jobs can be turned off');

create temp table feed_miles as
select id, miles_from_you
from public.driver_job_feed()
where id in (
  'a4100000-0000-4000-8000-000000000010',
  'a4100000-0000-4000-8000-000000000011'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select set_config('role', 'postgres', true);

select is(
  (select miles_from_you from feed_miles where id = 'a4100000-0000-4000-8000-000000000010'),
  0::numeric,
  'miles from you use the pickup ZIP centroid and round to the nearest mile'
);
select is(
  (select miles_from_you from feed_miles where id = 'a4100000-0000-4000-8000-000000000011'),
  round(public.private_miles_between(
    (select lat from public.ga_zip_centroids where zip = '30106'),
    (select lng from public.ga_zip_centroids where zip = '30106'),
    (select lat from public.ga_zip_centroids where zip = '31401'),
    (select lng from public.ga_zip_centroids where zip = '31401')
  ), 0),
  'the Savannah distance is the rounded centroid distance'
);

insert into public.drivers (
  profile_id, status, zone_id, home_city, home_zip, service_level, services, is_online,
  license_url, license_expires, insurance_url, insurance_expires, agreement_signed_at
) values (
  'a4100000-0000-4000-8000-000000000002',
  'active',
  (select id from public.zones where slug = 'east_gwinnett'),
  'Savannah',
  '31401',
  'light',
  array['delivery']::public.job_service[],
  true,
  'a4100000-0000-4000-8000-000000000002/license.jpg',
  '2027-12-31',
  'a4100000-0000-4000-8000-000000000002/insurance.jpg',
  '2027-12-31',
  now()
);
insert into public.vehicles (driver_id, type, approved)
values ('a4100000-0000-4000-8000-000000000002', 'pickup', true);
select public.apply_driver_coverage(
  'a4100000-0000-4000-8000-000000000002',
  array['Savannah'],
  '{}',
  null,
  null
);
update public.driver_feed_filters
set show_all = true
where profile_id = 'a4100000-0000-4000-8000-000000000002';
update public.drivers
set status = 'active', is_online = true
where profile_id = 'a4100000-0000-4000-8000-000000000001';
insert into public.vehicles (driver_id, type, approved)
values ('a4100000-0000-4000-8000-000000000001', 'pickup', true);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
  item_value_cents, stairs_pickup, stairs_dropoff, elevator, help_loading, preferred_date,
  pricing_method, service_level, required_vehicle
) values (
  'a4100000-0000-4000-8000-000000000013',
  'a4100000-0000-4000-8000-000000000003',
  'delivery', 'quoted', (select id from public.zones where slug = 'west_metro'),
  'Austell, 30106', 'Smyrna, 30080', 'Alert desk', 1, 'medium',
  0, 0, 0, false, false, 'asap', 'quote', 'light', 'pickup'
);
update public.jobs set status = 'open' where id = 'a4100000-0000-4000-8000-000000000013';

select is(
  (select count(*)::int from public.notifications where job_id = 'a4100000-0000-4000-8000-000000000013' and kind = 'new_job' and profile_id = 'a4100000-0000-4000-8000-000000000001'),
  1,
  'a matching online driver is alerted'
);
select is(
  (select count(*)::int from public.notifications where job_id = 'a4100000-0000-4000-8000-000000000013' and kind = 'new_job' and profile_id = 'a4100000-0000-4000-8000-000000000002'),
  0,
  'show all jobs does not send an alert outside coverage'
);

select pg_temp.as_user('a4100000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.claim_job('a4100000-0000-4000-8000-000000000013')$$,
  'a driver can accept an eligible job outside coverage'
);

select pg_temp.as_user('a4100000-0000-4000-8000-000000000003');
select ok(
  exists (
    select 1 from public.drivers_covering_pickup('Austell, 30106')
    where profile_id = 'a4100000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from public.drivers_covering_pickup('Austell, 30106')
    where profile_id = 'a4100000-0000-4000-8000-000000000002'
  ),
  'admin filter keeps the driver whose coverage includes the pickup'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select set_config('role', 'postgres', true);
update public.profiles set role = 'driver', full_name = 'Backfill Driver' where id = 'a4100000-0000-4000-8000-000000000004';
insert into public.drivers (profile_id, status, zone_id, service_level)
values (
  'a4100000-0000-4000-8000-000000000004',
  'active',
  (select id from public.zones where slug = 'west_metro'),
  'light'
);
select public.backfill_missing_coverage();
select is(
  (select radius_miles from public.driver_feed_filters where profile_id = 'a4100000-0000-4000-8000-000000000004'),
  25,
  'a driver without coverage is backfilled to 25 miles'
);
select is(
  (
    select count(*)::int from public.audit_log
    where action = 'backfill_coverage' and target_id = 'a4100000-0000-4000-8000-000000000004'
  ),
  1,
  'the coverage backfill is audit-logged'
);
select ok(
  position('lat' in pg_get_function_result('public.driver_job_feed()'::regprocedure)) = 0
    and position('lng' in pg_get_function_result('public.driver_job_feed()'::regprocedure)) = 0
    and position('pickup_address' in pg_get_function_result('public.driver_job_feed()'::regprocedure)) = 0,
  'the feed result has no coordinates or street address'
);

select * from finish();
rollback;
