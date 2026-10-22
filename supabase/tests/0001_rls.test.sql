-- Local Supabase only. Do not run this against the hosted project.
-- supabase test db applies migrations, runs this file, and rolls the test transaction back.

begin;

select plan(68);

-- pgTAP stays available after set role. This grant rolls back with the test.
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
end;
$$;

-- Clears the local JWT after reset role so the next fixture write runs as the
-- migration session. Call this only immediately before a harness write.
-- Authorization checks after that write must set the role under test again.
create or replace function pg_temp.clear_auth()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.make_user(uid uuid, email text)
returns void
language plpgsql
as $$
begin
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000',
    uid,
    'authenticated',
    'authenticated',
    email,
    'test-hash',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    uid::text,
    '',
    uid::text || '-email',
    uid::text || '-recovery'
  );
end;
$$;

select pg_temp.make_user('11111111-1111-4111-8111-111111111111', 'a@pickuply.test');
select pg_temp.make_user('22222222-2222-4222-8222-222222222222', 'b@pickuply.test');
select pg_temp.make_user('33333333-3333-4333-8333-333333333333', 'admin@pickuply.test');
select pg_temp.make_user('44444444-4444-4444-8444-444444444444', 'driver@pickuply.test');
select pg_temp.make_user('55555555-5555-4555-8555-555555555555', 'east@pickuply.test');
select pg_temp.make_user('66666666-6666-4666-8666-666666666666', 'light@pickuply.test');
select pg_temp.make_user('77777777-7777-4777-8777-777777777777', 'novehicle@pickuply.test');
select pg_temp.make_user('88888888-8888-4888-8888-888888888888', 'newdriver@pickuply.test');
select pg_temp.make_user('99999999-9999-4999-8999-999999999999', 'paused@pickuply.test');

update public.profiles set role = 'admin' where id = '33333333-3333-4333-8333-333333333333';
update public.profiles set role = 'driver' where id in (
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
  '77777777-7777-4777-8777-777777777777',
  '88888888-8888-4888-8888-888888888888',
  '99999999-9999-4999-8999-999999999999'
);

insert into public.drivers (profile_id, status, zone_id, service_level, services, max_distance_miles, is_online, last_lat, last_lng)
select id, 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], 25, true, 33.95, -84.55
from public.profiles
where id = '44444444-4444-4444-8444-444444444444';

insert into public.drivers (profile_id, status, zone_id, service_level, services, max_distance_miles, is_online, last_lat, last_lng)
select id, 'active', (select id from public.zones where slug = 'east_gwinnett'), 'full', array['delivery']::public.job_service[], 25, true, 34.0, -84.0
from public.profiles
where id = '55555555-5555-4555-8555-555555555555';

insert into public.drivers (profile_id, status, zone_id, service_level, services, max_distance_miles, is_online, last_lat, last_lng)
select id, 'active', (select id from public.zones where slug = 'west_metro'), 'light', array['delivery']::public.job_service[], 25, true, 33.95, -84.55
from public.profiles
where id = '66666666-6666-4666-8666-666666666666';

insert into public.drivers (profile_id, status, zone_id, service_level, services, max_distance_miles, is_online, last_lat, last_lng)
select id, 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['junk']::public.job_service[], 25, true, 33.95, -84.55
from public.profiles
where id = '77777777-7777-4777-8777-777777777777';

insert into public.drivers (profile_id, status, zone_id, service_level, services, max_distance_miles, is_online, last_lat, last_lng)
select id, 'approved_new', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], 25, false, 33.95, -84.55
from public.profiles
where id = '88888888-8888-4888-8888-888888888888';

insert into public.drivers (profile_id, status, zone_id, service_level, services, max_distance_miles, is_online)
select id, 'paused', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], 25, false
from public.profiles
where id = '99999999-9999-4999-8999-999999999999';

insert into public.vehicles (driver_id, type, approved)
values
  ('44444444-4444-4444-8444-444444444444', 'pickup', true),
  ('55555555-5555-4555-8555-555555555555', 'pickup', true),
  ('66666666-6666-4666-8666-666666666666', 'pickup', true),
  ('88888888-8888-4888-8888-888888888888', 'pickup', true),
  ('99999999-9999-4999-8999-999999999999', 'pickup', true);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  offer_cents, service_level, required_vehicle
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '11111111-1111-4111-8111-111111111111',
  'delivery',
  'open',
  (select id from public.zones where slug = 'west_metro'),
  'Marietta',
  'Couch on the porch at 10 Secret Street',
  1,
  'medium',
  0,
  0,
  false,
  false,
  'asap',
  'fixed',
  5000,
  'full',
  'pickup'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  offer_cents, service_level, required_vehicle
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  '22222222-2222-4222-8222-222222222222',
  'delivery',
  'requested',
  (select id from public.zones where slug = 'west_metro'),
  'Smyrna',
  'Customer B item',
  1,
  'small',
  0,
  0,
  false,
  false,
  'today',
  'fixed',
  4000,
  'full',
  'pickup'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  price_cents, driver_pay_cents, platform_fee_cents, service_level, required_vehicle
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  '11111111-1111-4111-8111-111111111111',
  'delivery',
  'quoted',
  (select id from public.zones where slug = 'west_metro'),
  'Marietta',
  'Quote job',
  1,
  'small',
  0,
  0,
  false,
  false,
  'asap',
  'quote',
  9000,
  7000,
  2000,
  'full',
  'pickup'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  price_cents, driver_pay_cents, service_level, required_vehicle
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  '11111111-1111-4111-8111-111111111111',
  'delivery',
  'quoted',
  (select id from public.zones where slug = 'west_metro'),
  'Marietta',
  'Second quote',
  1,
  'small',
  0,
  0,
  false,
  false,
  'asap',
  'quote',
  8000,
  6000,
  'full',
  'pickup'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  offer_cents, service_level, required_vehicle
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
  '11111111-1111-4111-8111-111111111111',
  'delivery',
  'open',
  (select id from public.zones where slug = 'west_metro'),
  'Marietta',
  'Uninvited job',
  1,
  'small',
  0,
  0,
  false,
  false,
  'asap',
  'fixed',
  4500,
  'full',
  'pickup'
);

insert into public.job_private (
  job_id, pickup_address, customer_name, customer_phone, customer_email, access_notes, pickup_lat, pickup_lng
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '10 Secret Street',
  'Customer A',
  '+14045550101',
  'a@pickuply.test',
  'gate 1234',
  33.952,
  -84.55
);

insert into public.job_private (
  job_id, pickup_address, customer_name, customer_phone, customer_email, access_notes
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  '20 Other Street',
  'Customer B',
  '+14045550102',
  'b@pickuply.test',
  'side door'
);

insert into storage.objects (bucket_id, name, owner_id)
values
  ('job-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/request/a.jpg', '11111111-1111-4111-8111-111111111111'),
  ('job-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/pickup/b.jpg', '44444444-4444-4444-8444-444444444444');

-- Privileges and feed shape. These do not depend on who is signed in.
select ok(
  not has_function_privilege('anon', 'public.driver_job_feed()', 'execute'),
  'anon cannot execute the driver feed'
);
select ok(
  has_function_privilege('authenticated', 'public.driver_job_feed()', 'execute'),
  'signed-in users can execute the driver feed'
);
select ok(
  not has_function_privilege('authenticated', 'public.driver_is_eligible_for_job(uuid)', 'execute'),
  'eligibility stays inside the database and is not callable'
);
select ok(
  not has_function_privilege('anon', 'public.driver_is_eligible_for_job(uuid)', 'execute'),
  'anon cannot execute the eligibility check'
);
select ok(
  position('description' in pg_get_function_result('public.driver_job_feed()'::regprocedure)) = 0,
  'feed result has no description'
);
select ok(
  position('customer_phone' in pg_get_functiondef('public.driver_job_feed()'::regprocedure)) = 0
  and position('customer_email' in pg_get_functiondef('public.driver_job_feed()'::regprocedure)) = 0
  and position('customer_name' in pg_get_functiondef('public.driver_job_feed()'::regprocedure)) = 0
  and position('access_notes' in pg_get_functiondef('public.driver_job_feed()'::regprocedure)) = 0
  and position('pickup_address' in pg_get_functiondef('public.driver_job_feed()'::regprocedure)) = 0
  and position('description' in pg_get_functiondef('public.driver_job_feed()'::regprocedure)) = 0,
  'feed function does not read private text or contact fields'
);

-- Customer A cannot see customer B. Anon cannot read private rows.
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select is(
  (select count(*)::int from public.jobs where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  0,
  'customer A cannot read customer B job'
);
select is(
  (select count(*)::int from public.job_private where job_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  0,
  'customer A cannot read customer B private details'
);
select is(
  (select count(*)::int from public.job_private where job_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  1,
  'customer A can read their own private details'
);
select throws_ok(
  $$update public.profiles set role = 'admin' where id = '11111111-1111-4111-8111-111111111111'$$,
  'users cannot change their own role',
  'a user cannot change their own role'
);
select throws_ok(
  $$insert into public.customer_driver_blocks (customer_id, driver_id) values ('22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444')$$,
  'customers can only manage their own blocks',
  'a customer cannot block a driver for someone else'
);
reset role;

set local role anon;
select throws_ok(
  'select * from public.job_private',
  '42501',
  NULL,
  'anon cannot read private job details'
);
select lives_ok('select id from public.zones', 'anon can read zones');
reset role;

-- Driver discovery.
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
set local role authenticated;
select is(
  (select count(*)::int from public.job_private),
  0,
  'a browsing driver cannot read private job details'
);
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  1,
  'an eligible active driver sees the open job'
);
select is(
  (select offer_cents from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  5000,
  'a fixed job shows the customer price'
);
select is(
  (select driver_pay_cents from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  null,
  'a fixed job does not show admin driver pay'
);
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  0,
  'a requested job is not in the feed'
);
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  0,
  'a quoted job is not in the feed'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'job-photos' and name like '%/pickup/%'),
  0,
  'a browsing driver cannot read pickup photos'
);
select lives_ok(
  $$insert into public.job_offers (job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, customer_total_cents, outside_range)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '44444444-4444-4444-8444-444444444444', 'accept', 5000, 0, 5000, false)$$,
  'an eligible online driver can accept a fixed price'
);
reset role;

select is(
  (select status::text from public.jobs where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'open',
  'accepting a price does not assign the job'
);
select is(
  (select assigned_driver_id from public.jobs where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  null,
  'accepting a price leaves assigned_driver_id empty'
);

select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select is(
  (select count(*)::int from public.job_offers where job_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  1,
  'the customer can read offers on their job'
);
select lives_ok(
  $$insert into public.customer_driver_blocks (customer_id, driver_id) values ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444')$$,
  'a customer can block a driver'
);
select throws_ok(
  $$insert into public.customer_driver_blocks (customer_id, driver_id) values ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444')$$,
  '23505',
  NULL,
  'a customer cannot block the same driver twice'
);
reset role;

select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
set local role authenticated;
select is(
  (select count(*)::int from public.job_offers where job_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  0,
  'another customer cannot read those offers'
);
select is(
  (select count(*)::int from public.customer_driver_blocks),
  0,
  'another customer cannot read the block list'
);
reset role;

select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  0,
  'a blocked driver cannot discover that customer job'
);
select throws_ok(
  $$insert into public.job_offers (job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, customer_total_cents, outside_range)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '44444444-4444-4444-8444-444444444444', 'accept', 5000, 0, 5000, false)$$,
  'this driver cannot offer on this job',
  'a blocked driver cannot offer'
);
select is(
  (select count(*)::int from public.customer_driver_blocks),
  0,
  'a driver cannot read the block list'
);
reset role;

select pg_temp.as_user('55555555-5555-4555-8555-555555555555');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  0,
  'a driver in another zone does not see the job'
);
reset role;

select pg_temp.as_user('66666666-6666-4666-8666-666666666666');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  0,
  'a light-service driver does not see a full-service job'
);
reset role;

select pg_temp.as_user('77777777-7777-4777-8777-777777777777');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  0,
  'a driver without the service and an approved vehicle does not see the job'
);
reset role;

select pg_temp.as_user('99999999-9999-4999-8999-999999999999');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed()),
  0,
  'a paused driver sees no jobs'
);
reset role;
select pg_temp.clear_auth();

update public.drivers set status = 'removed' where profile_id = '99999999-9999-4999-8999-999999999999';
select pg_temp.as_user('99999999-9999-4999-8999-999999999999');
set local role authenticated;
select is((select count(*)::int from public.driver_job_feed()), 0, 'a removed driver sees no jobs');
reset role;
select pg_temp.clear_auth();

update public.drivers set status = 'pending_review' where profile_id = '99999999-9999-4999-8999-999999999999';
select pg_temp.as_user('99999999-9999-4999-8999-999999999999');
set local role authenticated;
select is((select count(*)::int from public.driver_job_feed()), 0, 'a pending driver sees no jobs');
reset role;
select pg_temp.clear_auth();

update public.drivers set status = 'applied' where profile_id = '99999999-9999-4999-8999-999999999999';
select pg_temp.as_user('99999999-9999-4999-8999-999999999999');
set local role authenticated;
select is((select count(*)::int from public.driver_job_feed()), 0, 'an applied driver sees no jobs');
reset role;

select pg_temp.as_user('88888888-8888-4888-8888-888888888888');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed()),
  0,
  'an approved new driver sees nothing before an invitation'
);
reset role;
select pg_temp.clear_auth();

insert into public.job_driver_invitations (job_id, driver_id, invited_by)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '88888888-8888-4888-8888-888888888888',
  '33333333-3333-4333-8333-333333333333'
);
select is(
  (select assigned_driver_id from public.jobs where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  null,
  'an invitation does not assign the driver'
);
select pg_temp.as_user('88888888-8888-4888-8888-888888888888');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  1,
  'an approved new driver sees the invited open job'
);
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'),
  0,
  'an approved new driver does not see an open job without an invitation'
);
reset role;
select pg_temp.clear_auth();

insert into public.customer_driver_blocks (customer_id, driver_id)
values (
  '11111111-1111-4111-8111-111111111111',
  '88888888-8888-4888-8888-888888888888'
);
select pg_temp.as_user('88888888-8888-4888-8888-888888888888');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  0,
  'an invitation does not override a customer block'
);
reset role;

select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  0,
  'the blocked driver still cannot see the job after another driver is invited'
);
reset role;

-- Quote acceptance publishes. It does not assign.
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
set local role authenticated;
select throws_ok(
  $$update public.jobs set status = 'open' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'$$,
  'a quote job is published only when the customer accepts it',
  'an admin cannot publish a quote job directly'
);
select lives_ok(
  $$update public.jobs set price_cents = 8500 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'$$,
  'an admin can change the quote price'
);
select throws_ok(
  $$update public.jobs set offer_cents = 9000 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,
  'the customer pricing preference cannot be changed',
  'an admin cannot change the customer price'
);
reset role;

select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select lives_ok(
  $$select public.accept_admin_quote('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3')$$,
  'the customer can accept an admin quote'
);
reset role;
select is(
  (select status::text from public.jobs where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  'open',
  'accepting a quote publishes the job'
);
select is(
  (select assigned_driver_id from public.jobs where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  null,
  'accepting a quote does not assign a driver'
);

select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  0,
  'a blocked driver does not see a published quote job'
);
reset role;
select pg_temp.clear_auth();

delete from public.customer_driver_blocks
where customer_id = '11111111-1111-4111-8111-111111111111'
  and driver_id = '44444444-4444-4444-8444-444444444444';

select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
set local role authenticated;
select is(
  (select driver_pay_cents from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  7000,
  'a published quote job shows driver pay'
);
select is(
  (select offer_cents from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  null,
  'a quote job does not show a customer price'
);
select throws_ok(
  $$insert into public.job_offers (job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, customer_total_cents, outside_range)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', '44444444-4444-4444-8444-444444444444', 'offer', 7000, 0, 7000, false)$$,
  'drivers cannot offer on a quote job',
  'drivers cannot price a quote job'
);
reset role;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;

-- Pricing constraints. The signed-in customer still has to pass the own-job rule.
select throws_ok(
  $$insert into public.jobs (customer_id, service, pickup_area, description, pieces, size, item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents)
    values ('11111111-1111-4111-8111-111111111111', 'delivery', 'Marietta', 'x', 1, 'small', 0, 0, false, false, 'asap', 'fixed', 1000)$$,
  '23514',
  NULL,
  'a fixed price under $35 is rejected'
);
select throws_ok(
  $$insert into public.jobs (customer_id, service, pickup_area, description, pieces, size, item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, budget_min_cents, budget_max_cents)
    values ('11111111-1111-4111-8111-111111111111', 'delivery', 'Marietta', 'x', 1, 'small', 0, 0, false, false, 'asap', 'range', 5000, 5000)$$,
  '23514',
  NULL,
  'a range maximum equal to the minimum is rejected'
);
select throws_ok(
  $$insert into public.jobs (customer_id, service, pickup_area, description, pieces, size, item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents)
    values ('11111111-1111-4111-8111-111111111111', 'delivery', 'Marietta', 'x', 1, 'small', 0, 0, false, false, 'asap', 'quote', 5000)$$,
  '23514',
  NULL,
  'a quote job cannot store a customer amount'
);
reset role;
select pg_temp.clear_auth();
select throws_ok(
  $$update public.job_offers set status = 'chosen' where job_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,
  'choosing an offer requires the customer booking step',
  'nobody can book by marking an offer chosen'
);

-- Distance fails closed once coordinates exist.
select pg_temp.clear_auth();
update public.drivers
set last_lat = null, last_lng = null
where profile_id = '44444444-4444-4444-8444-444444444444';
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  0,
  'a job with coordinates is hidden when the driver location is missing'
);
reset role;
select pg_temp.clear_auth();

update public.drivers
set last_lat = 33.952, last_lng = -84.55, max_distance_miles = 10
where profile_id = '44444444-4444-4444-8444-444444444444';
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  1,
  'a driver inside the distance sees the job'
);
reset role;
select pg_temp.clear_auth();

update public.drivers
set max_distance_miles = 1, last_lat = 34.2, last_lng = -84.55
where profile_id = '44444444-4444-4444-8444-444444444444';
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  0,
  'a driver outside the distance does not see the job'
);
reset role;
select pg_temp.clear_auth();

-- Photos after assignment.
update public.jobs
set status = 'assigned', assigned_driver_id = '44444444-4444-4444-8444-444444444444'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
set local role authenticated;
select is(
  (select count(*)::int from public.job_private where job_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  1,
  'the assigned driver can read private details'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'job-photos' and name like 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/%'),
  2,
  'the assigned driver can read the job photos'
);
reset role;

select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
set local role authenticated;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'job-photos'),
  0,
  'another customer cannot read the photos'
);
reset role;

select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'job-photos' and name like 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/%'),
  2,
  'the customer can read their job photos'
);
reset role;

-- Service role and an empty session are not admins.
-- SET ROLE is enough. SET SESSION AUTHORIZATION needs a superuser, and this
-- database role is not one. 0005 stops a JWT-bearing session from counting
-- as the migration role, so the service role still cannot change quote prices.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok(
  $$update public.jobs set price_cents = 1111 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'$$,
  'only an admin can change quote prices',
  'the service role cannot set quote prices'
);
reset role;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select lives_ok(
  $$update public.jobs set price_cents = 2222 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'$$,
  'an empty session does not raise while row security hides the job'
);
reset role;
select is(
  (select price_cents from public.jobs where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'),
  8500,
  'an empty session cannot change quote prices'
);

select * from finish();
rollback;
