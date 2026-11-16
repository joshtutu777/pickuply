-- Local Supabase only. Do not run this against the hosted project.
-- These rows are synthetic. Do not point this file at a customer payment.

begin;

select plan(41);

create or replace function pg_temp.as_user(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.make_user(uid uuid, email text, user_phone text)
returns void language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, phone, encrypted_password, email_confirmed_at, phone_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    email, user_phone, 'test-hash', now(), now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now(), uid::text, '', uid::text || '-email', uid::text || '-recovery'
  );
  update public.profiles
  set first_name = 'Test', last_name = 'Person', full_name = 'Test Person', phone = user_phone
  where id = uid;
end;
$$;

create or replace function pg_temp.remove_verified(
  target uuid,
  observed text,
  sessions text[],
  intents text[],
  charges text[]
)
returns text
language plpgsql
as $$
begin
  return public.admin_remove_verified_marketplace(
    target,
    'c1420000-0000-4000-8000-000000000000',
    observed,
    sessions,
    intents,
    charges
  );
end;
$$;

select pg_temp.make_user('c1420000-0000-4000-8000-000000000000', 'admin-142@pickuply.test', '+15555501420');
select pg_temp.make_user('c1420000-0000-4000-8000-000000000001', 'customer-142@pickuply.test', '+15555501421');
select pg_temp.make_user('c1420000-0000-4000-8000-000000000002', 'driver-142@pickuply.test', '+15555501422');
update public.profiles set role = 'admin' where id = 'c1420000-0000-4000-8000-000000000000';
insert into public.drivers (profile_id, status, zone_id, is_online)
values (
  'c1420000-0000-4000-8000-000000000002',
  'active',
  (select id from public.zones limit 1),
  false
);

insert into public.jobs (
  id, customer_id, service, status, pickup_area, description, pieces, size, item_value_cents,
  stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values
  ('c1420000-0000-4000-8000-000000000101', 'c1420000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'no payment', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1420000-0000-4000-8000-000000000102', 'c1420000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'abandoned checkout', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1420000-0000-4000-8000-000000000103', 'c1420000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'failed charge', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1420000-0000-4000-8000-000000000104', 'c1420000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'canceled intent', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1420000-0000-4000-8000-000000000105', 'c1420000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'active hold', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1420000-0000-4000-8000-000000000106', 'c1420000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'captured payment', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1420000-0000-4000-8000-000000000107', 'c1420000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'pending refund', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1420000-0000-4000-8000-000000000108', 'c1420000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'disputed request', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1420000-0000-4000-8000-000000000109', 'c1420000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'assigned request', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1420000-0000-4000-8000-000000000110', 'c1420000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'payment changed', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1420000-0000-4000-8000-000000000111', 'c1420000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'status changed', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1420000-0000-4000-8000-000000000112', 'c1420000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'ledger obligation', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1420000-0000-4000-8000-000000000113', 'c1420000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'payout obligation', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1420000-0000-4000-8000-000000000114', 'c1420000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'trip fee', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1420000-0000-4000-8000-000000000115', 'c1420000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'failed refund', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000);

insert into public.jobs (
  id, customer_id, service, status, pickup_area, description, pieces, size, item_value_cents,
  stairs_pickup, elevator, help_loading, preferred_date, pricing_method
) values (
  'c1420000-0000-4000-8000-000000000116', 'c1420000-0000-4000-8000-000000000001', 'junk', 'quoted', 'Jonesboro', 'not posted', 1, 'medium', 0, 0, false, false, 'asap', 'quote'
);

update public.jobs set payment_status = 'failed' where id = 'c1420000-0000-4000-8000-000000000103';
update public.jobs
set payment_status = 'canceled', stripe_payment_intent_id = 'pi_test142canceled'
where id = 'c1420000-0000-4000-8000-000000000104';
update public.jobs
set payment_status = 'authorized', stripe_payment_intent_id = 'pi_test142hold'
where id = 'c1420000-0000-4000-8000-000000000105';
update public.jobs
set payment_status = 'captured', captured_cents = 5000, stripe_payment_intent_id = 'pi_test142charge'
where id = 'c1420000-0000-4000-8000-000000000106';
update public.jobs
set status = 'assigned', assigned_driver_id = 'c1420000-0000-4000-8000-000000000002'
where id = 'c1420000-0000-4000-8000-000000000109';
update public.jobs set trip_fee_cents = 1500 where id = 'c1420000-0000-4000-8000-000000000114';

insert into public.job_offers (
  job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents,
  customer_total_cents, status, expires_at
) values (
  'c1420000-0000-4000-8000-000000000101', 'c1420000-0000-4000-8000-000000000002',
  'accept', 5000, 0, 0, 5000, 'active', now() + interval '1 day'
);

insert into public.job_payments (job_id, checkout_session_id) values
  ('c1420000-0000-4000-8000-000000000102', 'cs_test142abandoned'),
  ('c1420000-0000-4000-8000-000000000110', 'cs_test142race'),
  ('c1420000-0000-4000-8000-000000000115', 'cs_test142failedrefund');
update public.job_payments
set payment_intent_id = 'pi_test142race'
where job_id = 'c1420000-0000-4000-8000-000000000110';
insert into public.job_payments (job_id, charge_id) values
  ('c1420000-0000-4000-8000-000000000103', 'ch_test142failed');

insert into public.payment_attempts (job_id, checkout_session_id, outcome) values
  ('c1420000-0000-4000-8000-000000000102', 'cs_test142abandoned', 'started'),
  ('c1420000-0000-4000-8000-000000000102', 'cs_test142abandoned', 'expired');

insert into public.refund_requests (job_id, amount_cents, reason, status, created_by) values
  ('c1420000-0000-4000-8000-000000000107', 1000, 'customer refund', 'pending', 'c1420000-0000-4000-8000-000000000000'),
  ('c1420000-0000-4000-8000-000000000115', 1000, 'failed refund', 'failed', 'c1420000-0000-4000-8000-000000000000');

insert into public.job_reports (id, job_id, reporter_id, category, description, outcome_wanted)
values (
  'c1420000-0000-4000-8000-000000000208',
  'c1420000-0000-4000-8000-000000000108',
  'c1420000-0000-4000-8000-000000000001',
  'other',
  'The request should stay open.',
  'note'
);
insert into public.job_disputes (job_id, report_id)
values ('c1420000-0000-4000-8000-000000000108', 'c1420000-0000-4000-8000-000000000208');

insert into public.ledger_entries (job_id, driver_id, amount_cents, status)
values ('c1420000-0000-4000-8000-000000000112', 'c1420000-0000-4000-8000-000000000002', 5000, 'pending');
insert into public.recovery_obligations (ledger_id, job_id, driver_id, amount_cents, status, reason)
select id, job_id, driver_id, 5000, 'recovery_due', 'test recovery'
from public.ledger_entries
where job_id = 'c1420000-0000-4000-8000-000000000112';
insert into public.payouts (job_id, driver_id, amount_cents, status)
values ('c1420000-0000-4000-8000-000000000113', 'c1420000-0000-4000-8000-000000000002', 5000, 'recorded');

select pg_temp.as_user('c1420000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.marketplace_removal_reason('c1420000-0000-4000-8000-000000000101')$$,
  'P0001',
  'only an admin can remove a request from the marketplace',
  'a customer cannot review removal'
);
select throws_ok(
  $$select public.admin_remove_verified_marketplace(
    'c1420000-0000-4000-8000-000000000101',
    'c1420000-0000-4000-8000-000000000001',
    '',
    array[]::text[],
    array[]::text[],
    array[]::text[]
  )$$,
  'P0001',
  'only an admin can remove a request from the marketplace',
  'a customer actor cannot remove a request'
);

select is(
  has_function_privilege('authenticated', 'public.admin_remove_verified_marketplace(uuid,uuid,text,text[],text[],text[])', 'execute'),
  false,
  'a signed-in user cannot call verified removal directly'
);
select is(
  has_function_privilege('service_role', 'public.admin_remove_verified_marketplace(uuid,uuid,text,text[],text[],text[])', 'execute'),
  true,
  'the server role can finish a verified removal'
);

select pg_temp.as_user('c1420000-0000-4000-8000-000000000000');
select is(public.marketplace_removal_reason('c1420000-0000-4000-8000-000000000101'), 'ready', 'no payment history is ready');
select is(public.marketplace_removal_reason('c1420000-0000-4000-8000-000000000102'), 'needs_stripe', 'an abandoned checkout needs a Stripe check');
select is(public.admin_remove_from_marketplace('c1420000-0000-4000-8000-000000000102'), 'has_payment', 'the strict removal still blocks an abandoned checkout');
select is(
  (select status from public.jobs where id = 'c1420000-0000-4000-8000-000000000102'),
  'open',
  'the strict removal leaves the abandoned request open'
);

select is(pg_temp.remove_verified('c1420000-0000-4000-8000-000000000101', '', array[]::text[], array[]::text[], array[]::text[]), 'removed', 'a request with no payment history can be removed');
select is(pg_temp.remove_verified('c1420000-0000-4000-8000-000000000101', '', array[]::text[], array[]::text[], array[]::text[]), 'already_removed', 'removing the same request again does not change it');
select is((select status from public.jobs where id = 'c1420000-0000-4000-8000-000000000101'), 'cancelled', 'the request is cancelled and still stored');
select is((select status from public.job_offers where job_id = 'c1420000-0000-4000-8000-000000000101'), 'declined', 'the open offer is closed and the offer row stays');
select is(
  (select count(*)::integer from public.job_events where job_id = 'c1420000-0000-4000-8000-000000000101' and type = 'removed_from_marketplace'),
  1,
  'a repeated removal does not write a second history row'
);
select is(
  (select count(*)::integer from public.audit_log where target_id = 'c1420000-0000-4000-8000-000000000101' and action = 'admin_remove_from_marketplace'),
  2,
  'the removal and the repeat are both audited'
);
select is(
  (select count(*)::integer from public.audit_log
    where target_id = 'c1420000-0000-4000-8000-000000000101'
      and action = 'admin_remove_from_marketplace'
      and data->>'outcome' = 'removed'),
  1,
  'a repeated removal does not record a second success'
);
select is(public.driver_is_eligible_for_job('c1420000-0000-4000-8000-000000000101'), false, 'the removed request is off the driver feed');

select is(
  pg_temp.remove_verified('c1420000-0000-4000-8000-000000000102', '', array['cs_test142abandoned']::text[], array[]::text[], array[]::text[]),
  'removed',
  'an abandoned checkout can be removed after its session id was verified'
);
select is(
  (select count(*)::integer from public.payment_attempts where job_id = 'c1420000-0000-4000-8000-000000000102'),
  2,
  'the abandoned payment attempts stay'
);
select is(
  (select count(*)::integer from public.job_payments where job_id = 'c1420000-0000-4000-8000-000000000102'),
  1,
  'the checkout row stays'
);
select is(
  pg_temp.remove_verified('c1420000-0000-4000-8000-000000000102', '', array['cs_test142abandoned']::text[], array[]::text[], array[]::text[]),
  'already_removed',
  'removing an abandoned request again is idempotent'
);
select is(
  (select count(*)::integer from public.job_events where job_id = 'c1420000-0000-4000-8000-000000000102' and type = 'removed_from_marketplace'),
  1,
  'the abandoned removal has one history row'
);

select is(
  pg_temp.remove_verified('c1420000-0000-4000-8000-000000000103', 'failed', array[]::text[], array[]::text[], array['ch_test142failed']::text[]),
  'removed',
  'a failed charge can be removed after Stripe verification'
);
select is(
  pg_temp.remove_verified('c1420000-0000-4000-8000-000000000104', 'canceled', array[]::text[], array['pi_test142canceled']::text[], array[]::text[]),
  'removed',
  'a canceled PaymentIntent can be removed after Stripe verification'
);
select is(
  pg_temp.remove_verified('c1420000-0000-4000-8000-000000000105', 'authorized', array[]::text[], array['pi_test142hold']::text[], array[]::text[]),
  'has_payment',
  'an active authorization blocks removal even when its id is supplied'
);
select is((select status from public.jobs where id = 'c1420000-0000-4000-8000-000000000105'), 'open', 'the authorized request stays open');
select is(
  pg_temp.remove_verified('c1420000-0000-4000-8000-000000000106', 'captured', array[]::text[], array['pi_test142charge']::text[], array[]::text[]),
  'has_payment',
  'a captured payment blocks removal'
);
select is(pg_temp.remove_verified('c1420000-0000-4000-8000-000000000107', '', array[]::text[], array[]::text[], array[]::text[]), 'has_payment', 'a pending refund blocks removal');
select is(pg_temp.remove_verified('c1420000-0000-4000-8000-000000000108', '', array[]::text[], array[]::text[], array[]::text[]), 'has_dispute', 'a dispute blocks removal');
select is(pg_temp.remove_verified('c1420000-0000-4000-8000-000000000109', '', array[]::text[], array[]::text[], array[]::text[]), 'has_driver', 'an assigned driver blocks removal');
select is((select status from public.jobs where id = 'c1420000-0000-4000-8000-000000000109'), 'assigned', 'the assigned request is unchanged');
select is(
  pg_temp.remove_verified('c1420000-0000-4000-8000-000000000110', '', array['cs_test142race']::text[], array[]::text[], array[]::text[]),
  'payment_changed',
  'a new PaymentIntent between the Stripe check and the lock blocks removal'
);
select is((select status from public.jobs where id = 'c1420000-0000-4000-8000-000000000110'), 'open', 'the changed payment leaves the request open');
select is(
  (select payment_intent_id from public.job_payments where job_id = 'c1420000-0000-4000-8000-000000000110'),
  'pi_test142race',
  'the unverified PaymentIntent stays stored'
);
select is(
  pg_temp.remove_verified('c1420000-0000-4000-8000-000000000111', 'failed', array[]::text[], array[]::text[], array[]::text[]),
  'payment_changed',
  'a payment status change between the check and the lock blocks removal'
);
select is((select status from public.jobs where id = 'c1420000-0000-4000-8000-000000000111'), 'open', 'the status mismatch leaves the request open');
select is(pg_temp.remove_verified('c1420000-0000-4000-8000-000000000112', '', array[]::text[], array[]::text[], array[]::text[]), 'has_payment', 'a ledger obligation blocks removal');
select is(pg_temp.remove_verified('c1420000-0000-4000-8000-000000000113', '', array[]::text[], array[]::text[], array[]::text[]), 'has_payment', 'a payout blocks removal');
select is(pg_temp.remove_verified('c1420000-0000-4000-8000-000000000114', '', array[]::text[], array[]::text[], array[]::text[]), 'has_payment', 'a trip fee blocks removal');
select is(
  pg_temp.remove_verified('c1420000-0000-4000-8000-000000000115', '', array['cs_test142failedrefund']::text[], array[]::text[], array[]::text[]),
  'removed',
  'a failed refund with an inactive checkout can be removed'
);
select is(
  (select count(*)::integer from public.refund_requests where job_id = 'c1420000-0000-4000-8000-000000000115'),
  1,
  'the failed refund row stays'
);
select is(pg_temp.remove_verified('c1420000-0000-4000-8000-000000000116', '', array[]::text[], array[]::text[], array[]::text[]), 'not_posted', 'a request that is not posted stays as it is');

select * from finish();
rollback;
