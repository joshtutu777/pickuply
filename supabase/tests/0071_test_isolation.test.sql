-- Local only. Test accounts stay out of the real lane.

begin;

select plan(28);

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

select set_config('pickuply.phone_hmac_secret', 'local-test-secret', true);
select pg_temp.make_user('c1710000-0000-4000-8000-000000000001', 'lane-real-customer@pickuply.test');
select pg_temp.make_user('c1710000-0000-4000-8000-000000000002', 'lane-real-driver@pickuply.test');
select pg_temp.make_user('c1710000-0000-4000-8000-000000000003', 'lane-test-customer@pickuply.test');
select pg_temp.make_user('c1710000-0000-4000-8000-000000000004', 'lane-test-driver@pickuply.test');
select pg_temp.make_user('c1710000-0000-4000-8000-000000000005', 'lane-real-admin@pickuply.test');
select pg_temp.make_user('c1710000-0000-4000-8000-000000000006', 'lane-test-admin@pickuply.test');

select pg_temp.clear_auth();
update public.platform_settings set waves_enabled = false where id = 1;
update public.profiles set role = 'driver', full_name = 'Real Driver' where id = 'c1710000-0000-4000-8000-000000000002';
update public.profiles set role = 'driver', full_name = 'Test Driver', is_test = true where id = 'c1710000-0000-4000-8000-000000000004';
update public.profiles set role = 'admin', full_name = 'Real Admin' where id = 'c1710000-0000-4000-8000-000000000005';
update public.profiles set role = 'admin', full_name = 'Test Admin', is_test = true where id = 'c1710000-0000-4000-8000-000000000006';
update public.profiles set full_name = 'Real Customer' where id = 'c1710000-0000-4000-8000-000000000001';
update public.profiles set full_name = 'Test Customer', is_test = true where id = 'c1710000-0000-4000-8000-000000000003';

insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online)
values
  ('c1710000-0000-4000-8000-000000000002', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], true),
  ('c1710000-0000-4000-8000-000000000004', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], true);

insert into public.driver_feed_filters (profile_id, cities)
values
  ('c1710000-0000-4000-8000-000000000002', array['Austell']),
  ('c1710000-0000-4000-8000-000000000004', array['Austell']);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values
  ('c1710000-0000-4000-8000-000000000011', 'c1710000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'real', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1710000-0000-4000-8000-000000000012', 'c1710000-0000-4000-8000-000000000003', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'test', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1710000-0000-4000-8000-000000000013', 'c1710000-0000-4000-8000-000000000003', 'delivery', 'completed', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'paid test', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000);

select is((select is_test from public.jobs where id = 'c1710000-0000-4000-8000-000000000012'), true, 'a test customer stamps a test job');
select is((select is_test from public.jobs where id = 'c1710000-0000-4000-8000-000000000011'), false, 'a real customer stamps a real job');

select pg_temp.as_user('c1710000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$update public.profiles set is_test = false where id = 'c1710000-0000-4000-8000-000000000003'$$,
  'test classification cannot be changed from the app',
  'a person cannot change the test flag'
);
reset role;
select pg_temp.clear_auth();

select pg_temp.as_user('c1710000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::integer from public.driver_browse_jobs() where id = 'c1710000-0000-4000-8000-000000000012'),
  0,
  'a real driver does not see a test job'
);
select is(
  (select count(*)::integer from public.driver_browse_jobs() where id = 'c1710000-0000-4000-8000-000000000011'),
  1,
  'a real driver still sees a real job'
);
select is(public.driver_is_eligible_for_job('c1710000-0000-4000-8000-000000000012'), false, 'a real driver cannot take a test job');
reset role;
select pg_temp.as_user('c1710000-0000-4000-8000-000000000004');
set local role authenticated;
select is(
  (select count(*)::integer from public.driver_browse_jobs() where id = 'c1710000-0000-4000-8000-000000000011'),
  0,
  'a test driver does not see a real job'
);
select is(
  (select count(*)::integer from public.driver_browse_jobs() where id = 'c1710000-0000-4000-8000-000000000012'),
  1,
  'a test driver sees a test job'
);
select is(public.driver_is_eligible_for_job('c1710000-0000-4000-8000-000000000011'), false, 'a test driver cannot take a real job');
reset role;
select pg_temp.clear_auth();

select throws_ok(
  $$update public.jobs set assigned_driver_id = 'c1710000-0000-4000-8000-000000000002' where id = 'c1710000-0000-4000-8000-000000000012'$$,
  'test and real accounts cannot be booked together',
  'a real driver cannot be assigned to a test job'
);

select is(
  (select count(*)::integer from public.notifications where profile_id = 'c1710000-0000-4000-8000-000000000002' and job_id = 'c1710000-0000-4000-8000-000000000012'),
  0,
  'a real driver is not alerted about a test job'
);
select is(
  (select count(*)::integer from public.notifications where profile_id = 'c1710000-0000-4000-8000-000000000004' and job_id = 'c1710000-0000-4000-8000-000000000011'),
  0,
  'a test driver is not alerted about a real job'
);
select is(
  (select count(*)::integer from public.notifications where profile_id = 'c1710000-0000-4000-8000-000000000002' and job_id = 'c1710000-0000-4000-8000-000000000011'),
  1,
  'a real driver is alerted about a real job'
);

insert into public.notifications (profile_id, job_id, kind, title, body, href, dedupe_key)
values (
  'c1710000-0000-4000-8000-000000000002',
  'c1710000-0000-4000-8000-000000000012',
  'new_job', 'Nope', 'Nope', '/driver', 'cross-lane-test'
);
select is(
  (select count(*)::integer from public.notifications where dedupe_key = 'cross-lane-test'),
  0,
  'a cross-lane alert is dropped'
);

select pg_temp.as_user('c1710000-0000-4000-8000-000000000005');
select is(
  (select count(*)::integer from public.announcement_recipients('{"kind":"customers"}'::jsonb, 'promotional') people where people.profile_id = 'c1710000-0000-4000-8000-000000000003'),
  0,
  'a real announcement leaves out test customers'
);
select pg_temp.as_user('c1710000-0000-4000-8000-000000000006');
select is(
  (select count(*)::integer from public.announcement_recipients('{"kind":"customers"}'::jsonb, 'promotional') people where people.profile_id = 'c1710000-0000-4000-8000-000000000003'),
  1,
  'a test announcement can reach a test customer'
);
select is(
  (select count(*)::integer from public.announcement_recipients('{"kind":"customers"}'::jsonb, 'promotional') people where people.profile_id = 'c1710000-0000-4000-8000-000000000001'),
  0,
  'a test announcement cannot reach a real customer'
);
set local role authenticated;
select throws_ok(
  $$select public.preview_test_data_cleanup()$$,
  'only a real admin can preview test data cleanup',
  'a test admin cannot preview cleanup'
);
reset role;
select pg_temp.clear_auth();

insert into public.job_offers (
  job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents, customer_total_cents, status, expires_at
) values (
  'c1710000-0000-4000-8000-000000000012', 'c1710000-0000-4000-8000-000000000004',
  'accept', 5000, 0, 0, 5000, 'active', now() + interval '1 day'
);

select pg_temp.as_user('c1710000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (select count(*)::integer from public.jobs where id = 'c1710000-0000-4000-8000-000000000012'),
  0,
  'a real customer cannot read a test job'
);
select is(
  (select count(*)::integer from public.job_offers where job_id = 'c1710000-0000-4000-8000-000000000012'),
  0,
  'a real customer cannot read a test offer'
);
reset role;
select pg_temp.as_user('c1710000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::integer from public.job_feed_signals where is_test),
  0,
  'a real driver does not receive a test feed signal'
);
reset role;
select pg_temp.as_user('c1710000-0000-4000-8000-000000000003');
set local role authenticated;
select is(
  (select count(*)::integer from public.job_offers where job_id = 'c1710000-0000-4000-8000-000000000012'),
  1,
  'the test customer can read the test offer'
);
reset role;
select pg_temp.clear_auth();

insert into public.driver_connect_accounts (driver_id, stripe_account_id, payouts_enabled)
values ('c1710000-0000-4000-8000-000000000004', 'acct_testlane013', true);
insert into public.job_payments (job_id, payment_intent_id, charge_id, stripe_livemode)
values ('c1710000-0000-4000-8000-000000000013', 'pi_testlane013', 'ch_testlane013', false);
insert into public.ledger_entries (id, job_id, driver_id, amount_cents, status)
values ('c1710000-0000-4000-8000-000000000021', 'c1710000-0000-4000-8000-000000000013', 'c1710000-0000-4000-8000-000000000004', 5000, 'ready');
select is(
  (select count(*)::integer from public.ready_transfers() where entry_id = 'c1710000-0000-4000-8000-000000000021'),
  0,
  'a test ledger row is not transferred'
);
select throws_ok(
  $$insert into public.job_payments (job_id, payment_intent_id, stripe_livemode) values ('c1710000-0000-4000-8000-000000000012', 'pi_testlane012', true)$$,
  'a test job cannot use a live Stripe payment',
  'a test job cannot store a live Stripe payment'
);

select pg_temp.as_user('c1710000-0000-4000-8000-000000000005');
set local role authenticated;
select throws_ok(
  $$select public.cleanup_test_data('no')$$,
  'type DELETE TEST DATA to confirm',
  'cleanup requires the confirmation phrase'
);
select lives_ok(
  $$select public.cleanup_test_data('DELETE TEST DATA')$$,
  'a real admin can retire test data'
);
reset role;
select pg_temp.clear_auth();

select is(
  (select test_retired_at is not null from public.jobs where id = 'c1710000-0000-4000-8000-000000000013'),
  true,
  'a paid test job is retired instead of deleted'
);
select is(
  (select count(*)::integer from public.ledger_entries where id = 'c1710000-0000-4000-8000-000000000021'),
  1,
  'the test ledger row is kept'
);

select * from finish();
rollback;
