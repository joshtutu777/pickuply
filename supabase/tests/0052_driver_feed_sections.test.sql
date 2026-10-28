-- Matched for You and All Georgia Requests. Waves off shows both at once.
-- The wake-up signal has no job or address data, and only an eligible driver can read it.

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

update public.platform_settings set waves_enabled = false;

select pg_temp.make_user('e5200000-0000-4000-8000-000000000001', 'feed-driver@pickuply.test');
select pg_temp.make_user('e5200000-0000-4000-8000-000000000002', 'feed-customer@pickuply.test');
select pg_temp.make_user('e5200000-0000-4000-8000-000000000003', 'feed-blocked-customer@pickuply.test');

insert into public.drivers (
  profile_id, status, zone_id, home_city, home_zip, service_level, services, is_online
) values (
  'e5200000-0000-4000-8000-000000000001',
  'active',
  (select id from public.zones where slug = 'west_metro'),
  'Austell',
  '30106',
  'light',
  array['delivery']::public.job_service[],
  true
);
insert into public.vehicles (driver_id, type, approved)
values ('e5200000-0000-4000-8000-000000000001', 'pickup', true);
insert into public.driver_feed_filters (profile_id, cities, zips, radius_miles)
values (
  'e5200000-0000-4000-8000-000000000001',
  '{}',
  array['31721'],
  null
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
  item_value_cents, stairs_pickup, stairs_dropoff, elevator, help_loading, preferred_date,
  pricing_method, offer_cents, service_level, required_vehicle
) values
  (
    'e5200000-0000-4000-8000-000000000010',
    'e5200000-0000-4000-8000-000000000002',
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Albany, 31721', 'Albany, 31721', 'Near desk', 1, 'medium',
    0, 0, 0, false, false, 'asap', 'fixed', 5000, 'light', null
  ),
  (
    'e5200000-0000-4000-8000-000000000011',
    'e5200000-0000-4000-8000-000000000002',
    'delivery', 'open', (select id from public.zones where slug = 'east_gwinnett'),
    'Savannah, 31401', 'Savannah, 31401', 'Far desk', 1, 'medium',
    0, 0, 0, false, false, 'asap', 'fixed', 5000, 'light', null
  ),
  (
    'e5200000-0000-4000-8000-000000000012',
    'e5200000-0000-4000-8000-000000000002',
    'delivery', 'open', (select id from public.zones where slug = 'east_gwinnett'),
    'Savannah, 31401', 'Savannah, 31401', 'Paused desk', 1, 'medium',
    0, 0, 0, false, false, 'asap', 'fixed', 5000, 'light', null
  ),
  (
    'e5200000-0000-4000-8000-000000000013',
    'e5200000-0000-4000-8000-000000000003',
    'delivery', 'open', (select id from public.zones where slug = 'east_gwinnett'),
    'Savannah, 31401', 'Savannah, 31401', 'Blocked desk', 1, 'medium',
    0, 0, 0, false, false, 'asap', 'fixed', 5000, 'light', null
  ),
  (
    'e5200000-0000-4000-8000-000000000014',
    'e5200000-0000-4000-8000-000000000002',
    'construction', 'open', (select id from public.zones where slug = 'east_gwinnett'),
    'Savannah, 31401', 'Savannah, 31401', 'Low pay desk', 1, 'medium',
    0, 0, 0, false, false, '2026-12-20', 'fixed', 4000, 'light', 'pickup'
  ),
  (
    'e5200000-0000-4000-8000-000000000015',
    'e5200000-0000-4000-8000-000000000002',
    'construction', 'open', (select id from public.zones where slug = 'east_gwinnett'),
    'Savannah, 31401', 'Savannah, 31401', 'High pay desk', 1, 'medium',
    0, 0, 0, false, false, '2026-12-20', 'fixed', 9000, 'light', 'box_truck'
  );

update public.jobs
set paused_at = now()
where id = 'e5200000-0000-4000-8000-000000000012';

insert into public.customer_driver_blocks (customer_id, driver_id)
values (
  'e5200000-0000-4000-8000-000000000003',
  'e5200000-0000-4000-8000-000000000001'
);

update public.jobs
set created_at = now() - interval '2 days'
where id = 'e5200000-0000-4000-8000-000000000010';
update public.jobs
set created_at = now()
where id = 'e5200000-0000-4000-8000-000000000011';

select pg_temp.as_user('e5200000-0000-4000-8000-000000000001');

select is(
  (select count(*)::int from public.driver_matched_feed() where id = 'e5200000-0000-4000-8000-000000000010'),
  1,
  'a coverage match is in Matched for You'
);
select is(
  (select date_group from public.driver_matched_feed() where id = 'e5200000-0000-4000-8000-000000000010'),
  'today',
  'an ASAP request is grouped as today'
);
select is(
  (select count(*)::int from public.driver_matched_feed() where id = 'e5200000-0000-4000-8000-000000000011'),
  0,
  'a pickup outside coverage is not in Matched for You'
);
select is(
  (select count(*)::int from public.driver_georgia_page() where id = 'e5200000-0000-4000-8000-000000000011'),
  1,
  'a pickup outside coverage is in All Georgia Requests'
);
select is(
  (select count(*)::int from public.driver_georgia_page() where id = 'e5200000-0000-4000-8000-000000000010'),
  1,
  'a matched request is also listed in All Georgia Requests'
);
select is(
  (select count(*)::int from public.driver_matched_feed() where id = 'e5200000-0000-4000-8000-000000000012')
  + (select count(*)::int from public.driver_georgia_page() where id = 'e5200000-0000-4000-8000-000000000012'),
  0,
  'a paused request is in neither section'
);
select is(
  (select count(*)::int from public.driver_matched_feed() where id = 'e5200000-0000-4000-8000-000000000013')
  + (select count(*)::int from public.driver_georgia_page() where id = 'e5200000-0000-4000-8000-000000000013'),
  0,
  'a customer block hides that customer from both sections'
);

select ok(
  (
    select ord_high < ord_low
    from (
      select
        max(ord) filter (where id = 'e5200000-0000-4000-8000-000000000015') as ord_high,
        max(ord) filter (where id = 'e5200000-0000-4000-8000-000000000014') as ord_low
      from (
        select id, row_number() over () as ord
        from public.driver_georgia_page(50, 0, 'pay', 'construction')
      ) page
    ) ranks
  ),
  'highest pay is sorted before a lower posted price'
);
select is(
  (select count(*)::int from public.driver_georgia_page(20, 0, 'nearest', 'construction', null, 'any', true) where id = 'e5200000-0000-4000-8000-000000000015'),
  0,
  'vehicle fit hides a request the driver vehicle cannot take'
);
select is(
  (select count(*)::int from public.driver_georgia_page(20, 0, 'nearest', 'construction', null, 'any', false) where id = 'e5200000-0000-4000-8000-000000000015'),
  1,
  'turning vehicle fit off keeps that request in All Georgia Requests'
);
select ok(
  (
    select ord_new < ord_old
    from (
      select
        max(ord) filter (where id = 'e5200000-0000-4000-8000-000000000011') as ord_new,
        max(ord) filter (where id = 'e5200000-0000-4000-8000-000000000010') as ord_old
      from (
        select id, row_number() over () as ord
        from public.driver_georgia_page(50, 0, 'newest')
      ) page
    ) ranks
  ),
  'newest requests are listed before older requests'
);

select throws_ok(
  $$insert into public.job_feed_signals default values$$,
  'permission denied for table job_feed_signals',
  'a driver cannot write a feed signal'
);
select cmp_ok(
  (select count(*)::int from public.job_feed_signals),
  '>',
  0,
  'an eligible driver can read the feed wake-up'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select set_config('role', 'postgres', true);

update public.platform_settings set waves_enabled = true;
select pg_temp.as_user('e5200000-0000-4000-8000-000000000001');
select set_config(
  'pickuply.wave_shown',
  (
    (
      select count(*)::int from public.driver_matched_feed()
      where id = 'e5200000-0000-4000-8000-000000000011'
    ) + (
      select count(*)::int from public.driver_georgia_page()
      where id = 'e5200000-0000-4000-8000-000000000011'
    )
  )::text,
  true
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select set_config('role', 'postgres', true);

select is(
  current_setting('pickuply.wave_shown')::int,
  case
    when public.job_released_to_driver(
      'e5200000-0000-4000-8000-000000000001',
      (select j from public.jobs j where j.id = 'e5200000-0000-4000-8000-000000000011')
    ) then 1
    else 0
  end,
  'with waves on, both sections follow that driver release'
);

select pg_temp.as_user('e5200000-0000-4000-8000-000000000002');
select is(
  (select count(*)::int from public.job_feed_signals),
  0,
  'a customer with no driver record cannot see feed signals'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select set_config('role', 'anon', true);
select throws_ok(
  $$select * from public.job_feed_signals$$,
  'permission denied for table job_feed_signals',
  'a signed-out visitor cannot read feed signals'
);

select set_config('role', 'postgres', true);
select ok(
  position('description' in pg_get_function_result('public.driver_matched_feed()'::regprocedure)) = 0
    and position('phone' in pg_get_function_result('public.driver_matched_feed()'::regprocedure)) = 0
    and position('email' in pg_get_function_result('public.driver_matched_feed()'::regprocedure)) = 0
    and position('lat' in pg_get_function_result('public.driver_matched_feed()'::regprocedure)) = 0
    and position('lng' in pg_get_function_result('public.driver_matched_feed()'::regprocedure)) = 0
    and position('pickup_address' in pg_get_function_result('public.driver_matched_feed()'::regprocedure)) = 0
    and position('access' in pg_get_function_result('public.driver_matched_feed()'::regprocedure)) = 0
    and position('description' in pg_get_function_result('public.driver_georgia_page(integer, integer, text, text, integer, text, boolean)'::regprocedure)) = 0
    and position('lat' in pg_get_function_result('public.driver_georgia_page(integer, integer, text, text, integer, text, boolean)'::regprocedure)) = 0
    and position('lng' in pg_get_function_result('public.driver_georgia_page(integer, integer, text, text, integer, text, boolean)'::regprocedure)) = 0,
  'the section feeds do not return a description, phone, email, coordinates, or street'
);

select * from finish();
rollback;
