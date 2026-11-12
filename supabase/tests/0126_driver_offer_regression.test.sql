-- Local only. Rolls back. Covers offer submission and Online checks after 0124-0126.

begin;

select plan(49);

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

select pg_temp.make_user('c1260000-0000-4000-8000-000000000001', 'reg-real-customer@pickuply.test');
select pg_temp.make_user('c1260000-0000-4000-8000-000000000002', 'reg-ready-driver@pickuply.test');
select pg_temp.make_user('c1260000-0000-4000-8000-000000000003', 'reg-pending-driver@pickuply.test');
select pg_temp.make_user('c1260000-0000-4000-8000-000000000004', 'reg-suspended-driver@pickuply.test');
select pg_temp.make_user('c1260000-0000-4000-8000-000000000005', 'reg-no-terms@pickuply.test');
select pg_temp.make_user('c1260000-0000-4000-8000-000000000006', 'reg-no-license@pickuply.test');
select pg_temp.make_user('c1260000-0000-4000-8000-000000000007', 'reg-old-insurance@pickuply.test');
select pg_temp.make_user('c1260000-0000-4000-8000-000000000008', 'reg-approved-new@pickuply.test');
select pg_temp.make_user('c1260000-0000-4000-8000-000000000009', 'reg-second-driver@pickuply.test');
select pg_temp.make_user('c1260000-0000-4000-8000-000000000010', 'reg-test-customer@pickuply.test');
select pg_temp.make_user('c1260000-0000-4000-8000-000000000011', 'reg-removed-driver@pickuply.test');

select pg_temp.clear_auth();
update public.platform_settings set waves_enabled = false where id = 1;
update public.profiles set full_name = 'Real Customer' where id = 'c1260000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'Ready Driver' where id = 'c1260000-0000-4000-8000-000000000002';
update public.profiles set role = 'driver', full_name = 'Pending Driver' where id = 'c1260000-0000-4000-8000-000000000003';
update public.profiles set role = 'driver', full_name = 'Suspended Driver' where id = 'c1260000-0000-4000-8000-000000000004';
update public.profiles set role = 'driver', full_name = 'No Terms' where id = 'c1260000-0000-4000-8000-000000000005';
update public.profiles set role = 'driver', full_name = 'No License' where id = 'c1260000-0000-4000-8000-000000000006';
update public.profiles set role = 'driver', full_name = 'Old Insurance' where id = 'c1260000-0000-4000-8000-000000000007';
update public.profiles set role = 'driver', full_name = 'New Approved' where id = 'c1260000-0000-4000-8000-000000000008';
update public.profiles set role = 'driver', full_name = 'Second Driver' where id = 'c1260000-0000-4000-8000-000000000009';
update public.profiles set full_name = 'Test Customer', is_test = true where id = 'c1260000-0000-4000-8000-000000000010';
update public.profiles set role = 'driver', full_name = 'Removed Driver' where id = 'c1260000-0000-4000-8000-000000000011';

insert into public.drivers (
  profile_id, status, home_city, home_zip, license_url, license_expires, insurance_url, insurance_expires, terms_version, terms_accepted_at, agreement_signed_at
) values
  ('c1260000-0000-4000-8000-000000000002', 'active', 'Austell', '30106', 'c1260000-0000-4000-8000-000000000002/license.jpg', public.georgia_today() - 1, 'c1260000-0000-4000-8000-000000000002/insurance.jpg', public.georgia_today() + 30, 'driver-terms-v2', now(), now()),
  ('c1260000-0000-4000-8000-000000000003', 'pending_review', 'Austell', '30106', 'c1260000-0000-4000-8000-000000000003/license.jpg', public.georgia_today() + 30, 'c1260000-0000-4000-8000-000000000003/insurance.jpg', public.georgia_today() + 30, 'driver-terms-v2', now(), now()),
  ('c1260000-0000-4000-8000-000000000004', 'active', 'Austell', '30106', 'c1260000-0000-4000-8000-000000000004/license.jpg', public.georgia_today() + 30, 'c1260000-0000-4000-8000-000000000004/insurance.jpg', public.georgia_today() + 30, 'driver-terms-v2', now(), now()),
  ('c1260000-0000-4000-8000-000000000005', 'active', 'Austell', '30106', 'c1260000-0000-4000-8000-000000000005/license.jpg', public.georgia_today() + 30, 'c1260000-0000-4000-8000-000000000005/insurance.jpg', public.georgia_today() + 30, null, null, now()),
  ('c1260000-0000-4000-8000-000000000006', 'active', 'Austell', '30106', null, null, 'c1260000-0000-4000-8000-000000000006/insurance.jpg', public.georgia_today() + 30, 'driver-terms-v2', now(), now()),
  ('c1260000-0000-4000-8000-000000000007', 'active', 'Austell', '30106', 'c1260000-0000-4000-8000-000000000007/license.jpg', public.georgia_today() + 30, 'c1260000-0000-4000-8000-000000000007/insurance.jpg', public.georgia_today() - 1, 'driver-terms-v2', now(), now()),
  ('c1260000-0000-4000-8000-000000000008', 'approved_new', 'Austell', '30106', 'c1260000-0000-4000-8000-000000000008/license.jpg', public.georgia_today() + 30, 'c1260000-0000-4000-8000-000000000008/insurance.jpg', public.georgia_today() + 30, 'driver-terms-v2', now(), now()),
  ('c1260000-0000-4000-8000-000000000009', 'active', 'Austell', '30106', 'c1260000-0000-4000-8000-000000000009/license.jpg', public.georgia_today() + 30, 'c1260000-0000-4000-8000-000000000009/insurance.jpg', public.georgia_today() + 30, 'driver-terms-v2', now(), now()),
  ('c1260000-0000-4000-8000-000000000011', 'removed', 'Austell', '30106', 'c1260000-0000-4000-8000-000000000011/license.jpg', public.georgia_today() + 30, 'c1260000-0000-4000-8000-000000000011/insurance.jpg', public.georgia_today() + 30, 'driver-terms-v2', now(), now());

insert into public.vehicles (driver_id, type, approved)
values
  ('c1260000-0000-4000-8000-000000000002', 'pickup', true),
  ('c1260000-0000-4000-8000-000000000009', 'pickup', true);

insert into public.account_suspensions (profile_id, status, kind, reason, created_by)
values (
  'c1260000-0000-4000-8000-000000000004',
  'active',
  'indefinite',
  'regression check',
  'c1260000-0000-4000-8000-000000000001'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents, pickup_availability
) values
  ('c1260000-0000-4000-8000-000000000021', 'c1260000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'open fixed', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000, 'asap'),
  ('c1260000-0000-4000-8000-000000000022', 'c1260000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'duplicate', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000, 'asap'),
  ('c1260000-0000-4000-8000-000000000023', 'c1260000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'needs car', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000, 'asap'),
  ('c1260000-0000-4000-8000-000000000024', 'c1260000-0000-4000-8000-000000000001', 'delivery', 'cancelled', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'cancelled', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000, 'asap'),
  ('c1260000-0000-4000-8000-000000000025', 'c1260000-0000-4000-8000-000000000001', 'delivery', 'completed', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'completed', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000, 'asap'),
  ('c1260000-0000-4000-8000-000000000027', 'c1260000-0000-4000-8000-000000000010', 'delivery', 'completed', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'old test completed', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000, null),
  ('c1260000-0000-4000-8000-000000000028', 'c1260000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'older open request', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000, null),
  ('c1260000-0000-4000-8000-000000000029', 'c1260000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'anytime request', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000, 'anytime'),
  ('c1260000-0000-4000-8000-000000000030', 'c1260000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'future window', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000, 'windows'),
  ('c1260000-0000-4000-8000-000000000031', 'c1260000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'past window', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000, 'windows'),
  ('c1260000-0000-4000-8000-000000000032', 'c1260000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'specific time', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000, 'anytime');

update public.jobs
set pickup_timezone = 'America/New_York'
where id in (
  'c1260000-0000-4000-8000-000000000021',
  'c1260000-0000-4000-8000-000000000029',
  'c1260000-0000-4000-8000-000000000030',
  'c1260000-0000-4000-8000-000000000031',
  'c1260000-0000-4000-8000-000000000032'
);

insert into public.job_pickup_windows (job_id, starts_at, ends_at, position)
values
  ('c1260000-0000-4000-8000-000000000030', now() + interval '1 day', now() + interval '1 day 2 hours', 1),
  ('c1260000-0000-4000-8000-000000000031', now() - interval '2 days', now() - interval '1 day', 1);

update public.jobs
set required_vehicle = 'car'
where id = 'c1260000-0000-4000-8000-000000000023';

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values (
  'c1260000-0000-4000-8000-000000000026',
  'c1260000-0000-4000-8000-000000000010',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'new test', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000
);

select is((select is_test from public.jobs where id = 'c1260000-0000-4000-8000-000000000021'), false, 'a new real request stays a real request');
select is((select is_test from public.jobs where id = 'c1260000-0000-4000-8000-000000000026'), true, 'a new test customer request stays a test request');
select is((select is_test from public.jobs where id = 'c1260000-0000-4000-8000-000000000027'), true, 'a completed test request stays a test request');

select pg_temp.as_user('c1260000-0000-4000-8000-000000000002');
select lives_ok($$select public.set_driver_online(true)$$, 'an approved driver with an expired license can go Online');
select is(public.driver_is_eligible_for_job('c1260000-0000-4000-8000-000000000021'), true, 'an approved driver can see an eligible open request');
select is(public.driver_is_eligible_for_job('c1260000-0000-4000-8000-000000000026'), false, 'a real driver cannot take a new test request');
select is(public.driver_is_eligible_for_job('c1260000-0000-4000-8000-000000000024'), false, 'a cancelled request is not eligible');
select is(public.driver_is_eligible_for_job('c1260000-0000-4000-8000-000000000025'), false, 'a completed request is not eligible');

select lives_ok(
  $$select public.submit_offer('c1260000-0000-4000-8000-000000000021', 'accept', null, null)$$,
  'an approved driver can offer without a pickup time'
);
select is((select preferred_date from public.jobs where id = 'c1260000-0000-4000-8000-000000000021'), 'asap', 'the customer pickup timing stays unchanged');
select ok(
  (select proposed_pickup_start is null and status = 'active' from public.job_offers where job_id = 'c1260000-0000-4000-8000-000000000021' and driver_id = 'c1260000-0000-4000-8000-000000000002'),
  'the offer is saved without replacing the pickup time'
);

select pg_temp.clear_auth();
select pg_temp.as_user('c1260000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (select count(*)::integer from public.job_offers where job_id = 'c1260000-0000-4000-8000-000000000021' and status = 'active'),
  1,
  'the customer can see the submitted offer'
);
reset role;

select pg_temp.as_user('c1260000-0000-4000-8000-000000000002');
select throws_ok(
  $$select public.submit_offer('c1260000-0000-4000-8000-000000000021', 'accept', null, null)$$,
  'withdraw your current offer before sending another',
  'a second active offer on the same request is rejected'
);
select throws_ok(
  $$select public.submit_offer('c1260000-0000-4000-8000-000000000023', 'accept', null, null)$$,
  'This job needs a different vehicle.',
  'a pickup cannot offer on a request that needs a car'
);
select throws_ok(
  $$select public.submit_offer('c1260000-0000-4000-8000-000000000024', 'accept', null, null)$$,
  'this driver cannot offer on this job',
  'a driver cannot offer on a cancelled request'
);
select throws_ok(
  $$select public.submit_offer('c1260000-0000-4000-8000-000000000025', 'accept', null, null)$$,
  'this driver cannot offer on this job',
  'a driver cannot offer on a completed request'
);
select lives_ok($$select public.set_driver_online(false)$$, 'the driver can go Offline');
select throws_ok(
  $$select public.submit_offer('c1260000-0000-4000-8000-000000000022', 'accept', null, null)$$,
  'go online before sending an offer',
  'an Offline driver cannot submit an offer'
);

select pg_temp.as_user('c1260000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.set_driver_online(true)$$,
  'Finish these steps. You can go Online after Pickuply approves you.',
  'a pending driver cannot go Online'
);
select throws_ok(
  $$select public.submit_offer('c1260000-0000-4000-8000-000000000022', 'accept', null, null)$$,
  'Finish setup to accept jobs.',
  'an unapproved driver cannot submit an offer'
);

select pg_temp.as_user('c1260000-0000-4000-8000-000000000011');
select throws_ok(
  $$select public.submit_offer('c1260000-0000-4000-8000-000000000022', 'accept', null, null)$$,
  'Finish setup to accept jobs.',
  'a removed driver cannot submit an offer'
);

select pg_temp.as_user('c1260000-0000-4000-8000-000000000006');
select lives_ok(
  $$select public.set_driver_online(true)$$,
  'a missing license photo does not block an approved driver'
);

select pg_temp.as_user('c1260000-0000-4000-8000-000000000005');
select throws_ok(
  $$select public.set_driver_online(true)$$,
  'Accept the Driver Terms to go Online.',
  'missing Driver Terms block Online'
);

select pg_temp.as_user('c1260000-0000-4000-8000-000000000007');
select lives_ok(
  $$select public.set_driver_online(true)$$,
  'expired insurance does not block an approved driver'
);

select pg_temp.as_user('c1260000-0000-4000-8000-000000000008');
select lives_ok($$select public.set_driver_online(true)$$, 'a legacy approved_new driver can go Online');

select pg_temp.as_user('c1260000-0000-4000-8000-000000000004');
select throws_ok(
  $$select public.set_driver_online(true)$$,
  'Your Pickuply driver account is restricted. You cannot go Online while this restriction is active.',
  'a suspended driver cannot go Online'
);
select throws_ok(
  $$select public.submit_offer('c1260000-0000-4000-8000-000000000022', 'accept', null, null)$$,
  'Your Pickuply driver account is restricted. You cannot submit offers or accept new jobs while this restriction is active.',
  'a suspended driver cannot submit an offer'
);

select pg_temp.as_user('c1260000-0000-4000-8000-000000000009');
select lives_ok($$select public.set_driver_online(true)$$, 'the second driver goes Online');
select lives_ok(
  $$select public.submit_offer('c1260000-0000-4000-8000-000000000028', 'accept', null, null)$$,
  'a second driver can submit an offer on the same older request'
);

select pg_temp.as_user('c1260000-0000-4000-8000-000000000002');
select lives_ok($$select public.set_driver_online(true)$$, 'the first driver goes back Online');
select lives_ok(
  $$select public.submit_offer('c1260000-0000-4000-8000-000000000028', 'accept', null, null)$$,
  'the first driver can offer on an older request without a pickup time'
);

select pg_temp.as_user('c1260000-0000-4000-8000-000000000001');
select lives_ok(
  $$select public.choose_offer((select id from public.job_offers where job_id = 'c1260000-0000-4000-8000-000000000028' and driver_id = 'c1260000-0000-4000-8000-000000000002'))$$,
  'the customer can accept an offer on an older request'
);
select is(
  (select status from public.job_offers where job_id = 'c1260000-0000-4000-8000-000000000028' and driver_id = 'c1260000-0000-4000-8000-000000000009'),
  'declined'::public.offer_status,
  'the offer that was not accepted is declined'
);
select ok(
  (select status = 'assigned' and assigned_driver_id = 'c1260000-0000-4000-8000-000000000002' and preferred_date = 'asap' from public.jobs where id = 'c1260000-0000-4000-8000-000000000028'),
  'accepting an offer assigns the driver and keeps the customer timing'
);
select lives_ok(
  $$select public.choose_offer((select id from public.job_offers where job_id = 'c1260000-0000-4000-8000-000000000021' and driver_id = 'c1260000-0000-4000-8000-000000000002'))$$,
  'an as-soon-as-possible request can be accepted without a pickup time'
);
select ok(
  (
    select status = 'assigned'
      and preferred_date = 'asap'
      and pickup_availability = 'asap'
      and scheduled_pickup_start is null
    from public.jobs
    where id = 'c1260000-0000-4000-8000-000000000021'
  ),
  'accepting an as-soon-as-possible offer keeps the customer timing'
);

select pg_temp.as_user('c1260000-0000-4000-8000-000000000009');
select throws_ok(
  $$select public.submit_offer('c1260000-0000-4000-8000-000000000032', 'accept', null, null, to_char(public.georgia_today() - 1, 'YYYY-MM-DD'), '15:00', null)$$,
  'That pickup time has passed. Choose a later time.',
  'a specific pickup time in the past is rejected'
);
select lives_ok(
  $$select public.submit_offer('c1260000-0000-4000-8000-000000000032', 'accept', null, null, to_char(public.georgia_today() + 1, 'YYYY-MM-DD'), '15:00', null)$$,
  'a future specific pickup time can be offered'
);
select lives_ok(
  $$select public.submit_offer('c1260000-0000-4000-8000-000000000029', 'accept', null, null)$$,
  'an anytime request can be offered without a pickup time'
);
select lives_ok(
  $$select public.submit_offer('c1260000-0000-4000-8000-000000000030', 'accept', null, null)$$,
  'a future pickup window can be offered without a driver time'
);
select lives_ok(
  $$select public.submit_offer('c1260000-0000-4000-8000-000000000031', 'accept', null, null)$$,
  'a passed pickup window can still receive an offer'
);

select pg_temp.as_user('c1260000-0000-4000-8000-000000000001');
select lives_ok(
  $$select public.choose_offer((select id from public.job_offers where job_id = 'c1260000-0000-4000-8000-000000000032' and driver_id = 'c1260000-0000-4000-8000-000000000009'))$$,
  'a future specific pickup time can be accepted'
);
select ok(
  (
    select preferred_date = 'asap'
      and scheduled_pickup_start is null
      and pickup_availability = 'anytime'
    from public.jobs
    where id = 'c1260000-0000-4000-8000-000000000032'
  ),
  'accepting a specific time does not overwrite the customer timing'
);
select lives_ok(
  $$select public.choose_offer((select id from public.job_offers where job_id = 'c1260000-0000-4000-8000-000000000029' and driver_id = 'c1260000-0000-4000-8000-000000000009'))$$,
  'an anytime request can be accepted without a pickup time'
);
select lives_ok(
  $$select public.choose_offer((select id from public.job_offers where job_id = 'c1260000-0000-4000-8000-000000000030' and driver_id = 'c1260000-0000-4000-8000-000000000009'))$$,
  'a future customer pickup window can be accepted'
);
select throws_ok(
  $$select public.choose_offer((select id from public.job_offers where job_id = 'c1260000-0000-4000-8000-000000000031' and driver_id = 'c1260000-0000-4000-8000-000000000009'))$$,
  'Your pickup windows have passed. Update your pickup time before choosing a driver.',
  'a passed pickup window asks the customer to update the timing'
);
select lives_ok(
  $$select public.update_open_pickup_timing('c1260000-0000-4000-8000-000000000031', 'asap')$$,
  'the customer can replace a passed window with as soon as possible'
);
select lives_ok(
  $$select public.choose_offer((select id from public.job_offers where job_id = 'c1260000-0000-4000-8000-000000000031' and driver_id = 'c1260000-0000-4000-8000-000000000009'))$$,
  'the updated request can then be accepted'
);

select pg_temp.clear_auth();
select throws_ok(
  $$update public.jobs set is_test = false where id = 'c1260000-0000-4000-8000-000000000026'$$,
  'a request from a test customer stays a test request',
  'a migration cannot turn a test customer request into a real request'
);

select * from finish();
rollback;
