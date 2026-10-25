-- A license stays valid through the end of its Georgia calendar date.

begin;

select plan(17);

do $$
declare
  sch text;
begin
  for sch in
    select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'ok'
  loop
    execute format('grant usage on schema %I to anon, authenticated, service_role', sch);
    execute format('grant execute on all functions in schema %I to anon, authenticated, service_role', sch);
  end loop;
end $$;

create or replace function pg_temp.as_user(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.clear_auth()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.make_user(uid uuid, email text)
returns void language plpgsql as $$
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

select pg_temp.make_user('c1720000-0000-4000-8000-000000000001', 'date-real-customer@pickuply.test');
select pg_temp.make_user('c1720000-0000-4000-8000-000000000002', 'date-ready-driver@pickuply.test');
select pg_temp.make_user('c1720000-0000-4000-8000-000000000003', 'date-pending-driver@pickuply.test');
select pg_temp.make_user('c1720000-0000-4000-8000-000000000004', 'date-suspended-driver@pickuply.test');
select pg_temp.make_user('c1720000-0000-4000-8000-000000000005', 'date-old-terms@pickuply.test');
select pg_temp.make_user('c1720000-0000-4000-8000-000000000006', 'date-test-customer@pickuply.test');
select pg_temp.make_user('c1720000-0000-4000-8000-000000000007', 'date-test-driver@pickuply.test');

select pg_temp.clear_auth();
update public.profiles set full_name = 'Real Customer' where id = 'c1720000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'Ready Driver' where id = 'c1720000-0000-4000-8000-000000000002';
update public.profiles set role = 'driver', full_name = 'Pending Driver' where id = 'c1720000-0000-4000-8000-000000000003';
update public.profiles set role = 'driver', full_name = 'Suspended Driver' where id = 'c1720000-0000-4000-8000-000000000004';
update public.profiles set role = 'driver', full_name = 'Old Terms' where id = 'c1720000-0000-4000-8000-000000000005';
update public.profiles set full_name = 'Test Customer', is_test = true where id = 'c1720000-0000-4000-8000-000000000006';
update public.profiles set role = 'driver', full_name = 'Test Driver', is_test = true where id = 'c1720000-0000-4000-8000-000000000007';

insert into public.drivers (
  profile_id, status, home_city, home_zip, license_url, license_expires, terms_version, terms_accepted_at, agreement_signed_at
) values
  ('c1720000-0000-4000-8000-000000000002', 'active', 'Austell', '30106', 'c1720000-0000-4000-8000-000000000002/license.jpg', public.georgia_today() - 1, 'driver-terms-v1', now(), now()),
  ('c1720000-0000-4000-8000-000000000003', 'pending_review', 'Austell', '30106', 'c1720000-0000-4000-8000-000000000003/license.jpg', public.georgia_today(), 'driver-terms-v1', now(), now()),
  ('c1720000-0000-4000-8000-000000000004', 'active', 'Austell', '30106', 'c1720000-0000-4000-8000-000000000004/license.jpg', public.georgia_today(), 'driver-terms-v1', now(), now()),
  ('c1720000-0000-4000-8000-000000000005', 'active', 'Austell', '30106', 'c1720000-0000-4000-8000-000000000005/license.jpg', public.georgia_today(), null, null, now()),
  ('c1720000-0000-4000-8000-000000000007', 'active', 'Austell', '30106', 'c1720000-0000-4000-8000-000000000007/license.jpg', public.georgia_today(), 'driver-terms-v1', now(), now());

insert into public.account_suspensions (profile_id, status, kind, reason, created_by)
values (
  'c1720000-0000-4000-8000-000000000004',
  'active',
  'indefinite',
  'lane check',
  'c1720000-0000-4000-8000-000000000001'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values (
  'c1720000-0000-4000-8000-000000000011',
  'c1720000-0000-4000-8000-000000000001',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'fixed real', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date,
  pricing_method, driver_pay_cents, platform_fee_cents
) values
  (
    'c1720000-0000-4000-8000-000000000012',
    'c1720000-0000-4000-8000-000000000001',
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell 30168', 'quote real', 1, 'medium', 0, 0, false, false, 'asap',
    'quote', 6000, 1000
  ),
  (
    'c1720000-0000-4000-8000-000000000013',
    'c1720000-0000-4000-8000-000000000006',
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell 30168', 'quote test', 1, 'medium', 0, 0, false, false, 'asap',
    'quote', 6000, 1000
  ),
  (
    'c1720000-0000-4000-8000-000000000014',
    'c1720000-0000-4000-8000-000000000001',
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell 30168', 'quote real untouched', 1, 'medium', 0, 0, false, false, 'asap',
    'quote', 6000, 1000
  );

select ok(not public.document_is_current(public.georgia_today() - 1), 'a license dated yesterday is expired');
select ok(public.document_is_current(public.georgia_today()), 'a license dated today is still valid');
select ok(public.document_is_current(public.georgia_today() + 1), 'a license dated tomorrow is valid');

select pg_temp.as_user('c1720000-0000-4000-8000-000000000002');
select throws_ok(
  $$select public.set_driver_online(true)$$,
  'Your license expired on ' || to_char(public.georgia_today() - 1, 'FMMM/FMDD/YYYY') || ' - upload a new photo to go Online.',
  'a license that expired yesterday blocks Online'
);

select pg_temp.clear_auth();
update public.drivers
set license_expires = public.georgia_today()
where profile_id = 'c1720000-0000-4000-8000-000000000002';
select pg_temp.as_user('c1720000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.set_driver_online(true)$$,
  'an approved driver with a license expiring today can go Online'
);

select pg_temp.clear_auth();
update public.drivers
set license_expires = public.georgia_today() + 1
where profile_id = 'c1720000-0000-4000-8000-000000000002';
select pg_temp.as_user('c1720000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.set_driver_online(true)$$,
  'a license expiring tomorrow can go Online'
);

select pg_temp.as_user('c1720000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.set_driver_online(true)$$,
  'Finish these steps. You can go Online after Pickuply approves you.',
  'a pending driver cannot go Online'
);

select pg_temp.as_user('c1720000-0000-4000-8000-000000000004');
select throws_ok(
  $$select public.submit_offer('c1720000-0000-4000-8000-000000000011', 'accept', null, null)$$,
  'Your Pickuply driver account is restricted. You cannot submit offers or accept new jobs while this restriction is active.',
  'a suspended driver still cannot submit an offer'
);

select pg_temp.as_user('c1720000-0000-4000-8000-000000000005');
select throws_ok(
  $$select public.set_driver_online(true)$$,
  'Accept the Driver Terms to go Online.',
  'outdated driver terms block Online'
);

select pg_temp.as_user('c1720000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.submit_offer('c1720000-0000-4000-8000-000000000011', 'accept', null, null)$$,
  'an eligible Online driver can submit an offer'
);
select lives_ok(
  $$select public.claim_job('c1720000-0000-4000-8000-000000000012')$$,
  'an eligible Online driver can claim an eligible job'
);
select lives_ok(
  $$select public.set_driver_online(false)$$,
  'the driver can go Offline'
);
select throws_ok(
  $$select public.submit_offer('c1720000-0000-4000-8000-000000000011', 'accept', null, null)$$,
  'go online before sending an offer',
  'an Offline driver cannot submit an offer'
);

select pg_temp.as_user('c1720000-0000-4000-8000-000000000007');
select lives_ok($$select public.set_driver_online(true)$$, 'the test driver can go Online');
select throws_ok(
  $$select public.claim_job('c1720000-0000-4000-8000-000000000014')$$,
  'this driver cannot claim this job',
  'a test driver cannot claim a real job'
);

select pg_temp.clear_auth();
update public.drivers set license_expires = public.georgia_today() where profile_id = 'c1720000-0000-4000-8000-000000000002';
select pg_temp.as_user('c1720000-0000-4000-8000-000000000002');
select lives_ok($$select public.set_driver_online(true)$$, 'the real driver goes back Online');
select throws_ok(
  $$select public.claim_job('c1720000-0000-4000-8000-000000000013')$$,
  'this driver cannot claim this job',
  'a real driver cannot claim a test job'
);

select * from finish();
rollback;
