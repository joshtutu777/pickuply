-- Local only. Approved suspension, payout, grace, stop-driving, and admin rules.

begin;

select plan(34);

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

create or replace function pg_temp.make_user(uid uuid, email text)
returns void language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    email, 'test-hash', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now(), now(), uid::text, '', uid::text || '-email', uid::text || '-recovery'
  );
end;
$$;

select set_config('pickuply.phone_hmac_secret', 'local-test-secret', true);

select pg_temp.make_user('c1630000-0000-4000-8000-000000000001', 'pol-customer@pickuply.test');
select pg_temp.make_user('c1630000-0000-4000-8000-000000000002', 'pol-driver@pickuply.test');
select pg_temp.make_user('c1630000-0000-4000-8000-000000000003', 'pol-admin@pickuply.test');
select pg_temp.make_user('c1630000-0000-4000-8000-000000000004', 'pol-driver2@pickuply.test');
select pg_temp.make_user('c1630000-0000-4000-8000-000000000005', 'pol-both@pickuply.test');

update public.profiles set full_name = 'Pol Customer', phone = '5555550181' where id = 'c1630000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'Pol Driver', phone = '5555550182' where id = 'c1630000-0000-4000-8000-000000000002';
update public.profiles set role = 'admin', full_name = 'Pol Admin' where id = 'c1630000-0000-4000-8000-000000000003';
update public.profiles set role = 'driver', full_name = 'Pol Driver Two', phone = '5555550184' where id = 'c1630000-0000-4000-8000-000000000004';
update public.profiles set role = 'customer', full_name = 'Pol Both', phone = '5555550185' where id = 'c1630000-0000-4000-8000-000000000005';

insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online, license_url)
values
  ('c1630000-0000-4000-8000-000000000002', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], true, 'c1630000-0000-4000-8000-000000000002/license.jpg'),
  ('c1630000-0000-4000-8000-000000000004', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], true, null),
  ('c1630000-0000-4000-8000-000000000005', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], true, 'c1630000-0000-4000-8000-000000000005/license.jpg');

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values
  ('c1630000-0000-4000-8000-000000000011', 'c1630000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'not started', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1630000-0000-4000-8000-000000000012', 'c1630000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'in transit', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1630000-0000-4000-8000-000000000013', 'c1630000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'paid', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000);

update public.jobs
set status = 'assigned', assigned_driver_id = 'c1630000-0000-4000-8000-000000000002', payment_status = 'authorized'
where id = 'c1630000-0000-4000-8000-000000000011';
update public.jobs
set status = 'in_transit', assigned_driver_id = 'c1630000-0000-4000-8000-000000000002', payment_status = 'authorized'
where id = 'c1630000-0000-4000-8000-000000000012';
update public.jobs
set status = 'completed', assigned_driver_id = 'c1630000-0000-4000-8000-000000000002', payment_status = 'captured', captured_cents = 5000
where id = 'c1630000-0000-4000-8000-000000000013';

insert into public.driver_connect_accounts (driver_id, stripe_account_id, payouts_enabled)
values ('c1630000-0000-4000-8000-000000000002', 'acct_policy000001', true);
insert into public.ledger_entries (job_id, driver_id, amount_cents, status, available_on)
values ('c1630000-0000-4000-8000-000000000013', 'c1630000-0000-4000-8000-000000000002', 4000, 'pending', now() - interval '3 days');
set local session_replication_role = replica;
update public.jobs set updated_at = now() - interval '3 days' where id = 'c1630000-0000-4000-8000-000000000013';
set local session_replication_role = origin;

insert into public.job_offers (
  job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents, customer_total_cents, status, expires_at
) values (
  'c1630000-0000-4000-8000-000000000011', 'c1630000-0000-4000-8000-000000000005',
  'accept', 5000, 0, 0, 5000, 'active', now() + interval '1 day'
);

select pg_temp.as_user('c1630000-0000-4000-8000-000000000003');
set local role authenticated;
select lives_ok(
  $$select public.suspend_account('c1630000-0000-4000-8000-000000000002', 'indefinite', 'active delivery', null, null)$$,
  'admin suspends the driver'
);
select is(
  (select needs_reassignment from public.jobs where id = 'c1630000-0000-4000-8000-000000000011'),
  true,
  'an assigned job that has not started is flagged'
);
select is(
  (select needs_reassignment from public.jobs where id = 'c1630000-0000-4000-8000-000000000012'),
  false,
  'a job already in transit is not flagged for reassignment'
);

reset role;
select pg_temp.as_user('c1630000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.advance_job('c1630000-0000-4000-8000-000000000011', 'en_route')$$,
  'This booking requires assistance from Pickuply support.',
  'a suspended driver cannot start an assigned job'
);
select throws_ok(
  $$select public.advance_job('c1630000-0000-4000-8000-000000000012', 'delivered')$$,
  'add the delivery photo first',
  'a suspended driver can continue a job already in transit'
);
reset role;
select is(
  (select payment_status::text from public.jobs where id = 'c1630000-0000-4000-8000-000000000011'),
  'authorized',
  'flagging a job does not change the payment'
);
select throws_ok(
  $$update public.jobs set price_cents = 1 where id = 'c1630000-0000-4000-8000-000000000011'$$,
  'This booking requires assistance from Pickuply support.',
  'a flagged booking cannot be repriced directly'
);

select pg_temp.as_user('c1630000-0000-4000-8000-000000000003');
set local role authenticated;
select lives_ok(
  $$select public.reassign_flagged_job('c1630000-0000-4000-8000-000000000011', 'c1630000-0000-4000-8000-000000000004')$$,
  'an admin can assign a new driver'
);
reset role;
select is(
  (select payment_status::text from public.jobs where id = 'c1630000-0000-4000-8000-000000000011'),
  'authorized',
  'reassignment keeps the existing payment'
);

select public.refresh_ledger_readiness();
select is(
  (select status from public.ledger_entries where job_id = 'c1630000-0000-4000-8000-000000000013'),
  'ready',
  'suspension alone does not hold earned pay'
);
insert into public.job_reports (job_id, reporter_id, category, description, outcome_wanted)
values (
  'c1630000-0000-4000-8000-000000000013',
  'c1630000-0000-4000-8000-000000000001',
  'damaged',
  'The item was damaged',
  'refund'
);
insert into public.job_disputes (job_id, report_id, capture_hold, payout_hold)
select 'c1630000-0000-4000-8000-000000000013', id, true, true
from public.job_reports
where job_id = 'c1630000-0000-4000-8000-000000000013';
select public.refresh_ledger_readiness();
select is(
  (select status from public.ledger_entries where job_id = 'c1630000-0000-4000-8000-000000000013'),
  'held',
  'an open dispute still holds pay after the driver is suspended'
);

select pg_temp.as_user('c1630000-0000-4000-8000-000000000005');
set local role authenticated;
select is(
  public.stop_driving(),
  'stopped',
  'a customer who also drives can stop driving'
);
reset role;
select is(
  (select phone from public.profiles where id = 'c1630000-0000-4000-8000-000000000005'),
  '5555550185',
  'stopping driving keeps the customer phone'
);
select is(
  (select status::text from public.job_offers where driver_id = 'c1630000-0000-4000-8000-000000000005'),
  'expired',
  'stopping driving closes unaccepted offers'
);
select is(
  (select license_url is null from public.drivers where profile_id = 'c1630000-0000-4000-8000-000000000005'),
  true,
  'driver-only documents are cleared when nothing is owed'
);

select pg_temp.as_user('c1630000-0000-4000-8000-000000000002');
set local role authenticated;
select is(public.stop_driving(), 'pending', 'a driver with open pay does not lose the account');
reset role;
select is(
  (select phone is not null and deleted_at is null from public.profiles where id = 'c1630000-0000-4000-8000-000000000002'),
  true,
  'a driver-only stop keeps the sign-in account'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
reset role;

select pg_temp.make_user('c1630000-0000-4000-8000-000000000006', 'pol-clean@pickuply.test');
select pg_temp.make_user('c1630000-0000-4000-8000-000000000007', 'pol-busy@pickuply.test');
select pg_temp.make_user('c1630000-0000-4000-8000-000000000008', 'pol-restricted@pickuply.test');
update public.profiles set phone = '5555550186' where id = 'c1630000-0000-4000-8000-000000000006';
update public.profiles set phone = '5555550187' where id = 'c1630000-0000-4000-8000-000000000007';
update public.profiles set phone = '5555550188' where id = 'c1630000-0000-4000-8000-000000000008';

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values (
  'c1630000-0000-4000-8000-000000000014',
  'c1630000-0000-4000-8000-000000000007',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'still assigned', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000
);
update public.jobs
set status = 'assigned', assigned_driver_id = 'c1630000-0000-4000-8000-000000000004', payment_status = 'authorized'
where id = 'c1630000-0000-4000-8000-000000000014';

select pg_temp.as_user('c1630000-0000-4000-8000-000000000006');
set local role authenticated;
select is(public.request_account_deletion(), 'pending', 'deletion starts a pending request');
select lives_ok($$select public.cancel_account_deletion()$$, 'the person can cancel during the 14 days');
select is(public.request_account_deletion(), 'pending', 'a cancelled request can be made again');
reset role;
update public.account_deletion_requests
set grace_ends_at = now() - interval '1 minute'
where profile_id = 'c1630000-0000-4000-8000-000000000006' and status = 'pending';
select pg_temp.as_user('c1630000-0000-4000-8000-000000000006');
set local role authenticated;
select throws_ok(
  $$select public.cancel_account_deletion()$$,
  'this deletion request cannot be cancelled',
  'cancellation closes when the 14 days end'
);
reset role;
select lives_ok($$select public.process_due_deletions()$$, 'the grace period deletes a clear account');
select lives_ok($$select public.process_due_deletions()$$, 'running cleanup again is safe');
select is(
  (select deleted_at is not null and phone is null from public.profiles where id = 'c1630000-0000-4000-8000-000000000006'),
  true,
  'the clear account is deleted once'
);
select is(
  (select count(*)::integer from public.account_deletion_requests where profile_id = 'c1630000-0000-4000-8000-000000000006' and status = 'completed'),
  1,
  'a second run does not complete deletion twice'
);

select pg_temp.as_user('c1630000-0000-4000-8000-000000000007');
set local role authenticated;
select is(public.request_account_deletion(), 'pending', 'a busy account can still request deletion');
reset role;
update public.account_deletion_requests
set grace_ends_at = timestamptz '2026-01-01 00:00:00+00'
where profile_id = 'c1630000-0000-4000-8000-000000000007' and status = 'pending';
select lives_ok($$select public.process_due_deletions()$$, 'a busy account is checked again');
select is(
  (select grace_ends_at from public.account_deletion_requests where profile_id = 'c1630000-0000-4000-8000-000000000007' and status = 'pending'),
  timestamptz '2026-01-01 00:00:00+00',
  'a remaining blocker does not restart the 14 days'
);

select pg_temp.as_user('c1630000-0000-4000-8000-000000000003');
set local role authenticated;
select lives_ok(
  $$select public.suspend_account('c1630000-0000-4000-8000-000000000008', 'indefinite', 'restricted phone', null, null)$$,
  'admin suspends an account before deletion'
);
reset role;
select pg_temp.as_user('c1630000-0000-4000-8000-000000000008');
set local role authenticated;
select is(public.request_account_deletion(), 'pending', 'a suspended account requests deletion');
reset role;
update public.account_deletion_requests
set grace_ends_at = now() - interval '1 minute'
where profile_id = 'c1630000-0000-4000-8000-000000000008' and status = 'pending';
select set_config('pickuply.phone_hmac_secret', '', true);
select lives_ok($$select public.process_due_deletions()$$, 'a missing secret does not finish a restricted deletion');
select is(
  (select phone is not null and deleted_at is null from public.profiles where id = 'c1630000-0000-4000-8000-000000000008'),
  true,
  'the restricted phone is still on the account'
);
select throws_ok(
  $$select pg_temp.make_user('c1630000-0000-4000-8000-000000000009', 'pol-new@pickuply.test')$$,
  'registration is unavailable until phone protection is configured',
  'a missing secret does not allow a new registration'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
reset role;
update public.profiles set role = 'customer'
where role = 'admin' and id <> 'c1630000-0000-4000-8000-000000000003';
select throws_ok(
  $$update public.profiles set role = 'customer' where id = 'c1630000-0000-4000-8000-000000000003'$$,
  'the last active admin cannot be removed',
  'the last active admin cannot be demoted'
);

select * from finish();
rollback;
