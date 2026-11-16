-- Local Supabase only. Do not run this against the hosted project.
-- These rows are synthetic. Do not point this file at a customer payment.

begin;

select plan(20);

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

select pg_temp.make_user('c1430000-0000-4000-8000-000000000000', 'admin-143@pickuply.test', '+15555501430');
select pg_temp.make_user('c1430000-0000-4000-8000-000000000001', 'customer-143@pickuply.test', '+15555501431');
select pg_temp.make_user('c1430000-0000-4000-8000-000000000002', 'driver-143@pickuply.test', '+15555501432');
update public.profiles set role = 'admin' where id = 'c1430000-0000-4000-8000-000000000000';
insert into public.drivers (profile_id, status, zone_id, is_online)
values (
  'c1430000-0000-4000-8000-000000000002',
  'active',
  (select id from public.zones limit 1),
  false
);

insert into public.jobs (
  id, customer_id, service, status, pickup_area, description, pieces, size, item_value_cents,
  stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values
  ('c1430000-0000-4000-8000-000000000101', 'c1430000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'waiting checkout', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1430000-0000-4000-8000-000000000102', 'c1430000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'released checkout', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1430000-0000-4000-8000-000000000103', 'c1430000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'authorized checkout', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1430000-0000-4000-8000-000000000104', 'c1430000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'wrong driver', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1430000-0000-4000-8000-000000000105', 'c1430000-0000-4000-8000-000000000001', 'junk', 'open', 'Jonesboro', 'removed checkout', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000);

update public.jobs
set status = 'assigned',
    assigned_driver_id = 'c1430000-0000-4000-8000-000000000002',
    payment_status = 'awaiting_payment',
    payment_due_at = now() + interval '30 minutes'
where id in (
  'c1430000-0000-4000-8000-000000000101',
  'c1430000-0000-4000-8000-000000000102',
  'c1430000-0000-4000-8000-000000000104',
  'c1430000-0000-4000-8000-000000000105'
);
update public.jobs
set status = 'assigned',
    assigned_driver_id = 'c1430000-0000-4000-8000-000000000002',
    payment_status = 'authorized',
    payment_due_at = now() + interval '30 minutes'
where id = 'c1430000-0000-4000-8000-000000000103';

insert into public.job_payments (job_id, checkout_attempt, checkout_driver_id) values
  ('c1430000-0000-4000-8000-000000000101', 1, 'c1430000-0000-4000-8000-000000000002'),
  ('c1430000-0000-4000-8000-000000000102', 1, 'c1430000-0000-4000-8000-000000000002'),
  ('c1430000-0000-4000-8000-000000000103', 1, 'c1430000-0000-4000-8000-000000000002'),
  ('c1430000-0000-4000-8000-000000000104', 1, 'c1430000-0000-4000-8000-000000000001'),
  ('c1430000-0000-4000-8000-000000000105', 1, 'c1430000-0000-4000-8000-000000000002');

select public.record_checkout_session('c1430000-0000-4000-8000-000000000101', 'cs_test143first', 1);
select is(
  (select checkout_session_id from public.job_payments where job_id = 'c1430000-0000-4000-8000-000000000101'),
  'cs_test143first',
  'the current attempt stores its checkout session'
);
select is(
  (select count(*)::integer from public.payment_attempts where job_id = 'c1430000-0000-4000-8000-000000000101' and outcome = 'started'),
  1,
  'the first session writes one started attempt'
);
select public.record_checkout_session('c1430000-0000-4000-8000-000000000101', 'cs_test143first', 1);
select is(
  (select count(*)::integer from public.payment_attempts where job_id = 'c1430000-0000-4000-8000-000000000101' and outcome = 'started'),
  1,
  'saving the same session again does not add another attempt'
);
select throws_ok(
  $$select public.record_checkout_session('c1430000-0000-4000-8000-000000000101', 'cs_test143other', 1)$$,
  'P0001',
  'checkout attempt does not match',
  'a different session cannot replace the session for this attempt'
);
select is(
  (select checkout_session_id from public.job_payments where job_id = 'c1430000-0000-4000-8000-000000000101'),
  'cs_test143first',
  'the rejected session leaves the stored session in place'
);

update public.job_payments
set checkout_attempt = 2
where job_id = 'c1430000-0000-4000-8000-000000000101';
select public.record_checkout_session('c1430000-0000-4000-8000-000000000101', 'cs_test143retry', 2);
select is(
  (select checkout_session_id from public.job_payments where job_id = 'c1430000-0000-4000-8000-000000000101'),
  'cs_test143retry',
  'the next attempt can replace the previous session'
);
select is(
  (select count(distinct checkout_session_id)::integer from public.payment_attempts where job_id = 'c1430000-0000-4000-8000-000000000101' and outcome = 'started'),
  2,
  'the earlier session stays in the attempt history'
);
select throws_ok(
  $$select public.record_checkout_session('c1430000-0000-4000-8000-000000000101', 'cs_test143stale', 1)$$,
  'P0001',
  'checkout attempt does not match',
  'an older attempt cannot overwrite the newer session'
);
select is(
  (select checkout_session_id from public.job_payments where job_id = 'c1430000-0000-4000-8000-000000000101'),
  'cs_test143retry',
  'the stale attempt leaves the newer session in place'
);

update public.jobs
set status = 'cancelled'
where id = 'c1430000-0000-4000-8000-000000000101';
select throws_ok(
  $$select public.record_checkout_session('c1430000-0000-4000-8000-000000000101', 'cs_test143after', 2)$$,
  'P0001',
  'this request was cancelled',
  'a cancelled request rejects the new session'
);
select is(
  (select checkout_session_id from public.job_payments where job_id = 'c1430000-0000-4000-8000-000000000101'),
  'cs_test143retry',
  'the cancelled request keeps its earlier session'
);
select is(
  (select count(*)::integer from public.payment_attempts where job_id = 'c1430000-0000-4000-8000-000000000101'),
  2,
  'the rejected session does not add an attempt'
);

update public.jobs
set status = 'open', assigned_driver_id = null, payment_status = 'none', payment_due_at = null
where id = 'c1430000-0000-4000-8000-000000000102';
select throws_ok(
  $$select public.record_checkout_session('c1430000-0000-4000-8000-000000000102', 'cs_test143released', 1)$$,
  'P0001',
  'this job is not waiting for payment',
  'a released request rejects the new session'
);
select is(
  (select checkout_session_id from public.job_payments where job_id = 'c1430000-0000-4000-8000-000000000102'),
  null,
  'the released request does not gain a session'
);
select throws_ok(
  $$select public.record_checkout_session('c1430000-0000-4000-8000-000000000103', 'cs_test143hold', 1)$$,
  'P0001',
  'this job is not waiting for payment',
  'an authorized payment rejects another session'
);
select throws_ok(
  $$select public.record_checkout_session('c1430000-0000-4000-8000-000000000104', 'cs_test143driver', 1)$$,
  'P0001',
  'this job is not waiting for payment',
  'a different assigned driver rejects the session'
);
select throws_ok(
  $$select public.record_checkout_session('c1430000-0000-4000-8000-000000000105', 'cs_test143wrong', 4)$$,
  'P0001',
  'checkout attempt does not match',
  'an attempt number that is not current is rejected'
);

select public.record_checkout_session('c1430000-0000-4000-8000-000000000105', 'cs_test143before', 1);
update public.jobs
set status = 'open', assigned_driver_id = null, payment_status = 'none', payment_due_at = null
where id = 'c1430000-0000-4000-8000-000000000105';
select public.admin_remove_verified_marketplace(
  'c1430000-0000-4000-8000-000000000105',
  'c1430000-0000-4000-8000-000000000000',
  '',
  array['cs_test143before']::text[],
  array[]::text[],
  array[]::text[]
);
select throws_ok(
  $$select public.record_checkout_session('c1430000-0000-4000-8000-000000000105', 'cs_test143late', 1)$$,
  'P0001',
  'this request was cancelled',
  'a session created before removal is not saved after removal'
);
select is(
  (select checkout_session_id from public.job_payments where job_id = 'c1430000-0000-4000-8000-000000000105'),
  'cs_test143before',
  'removal leaves the earlier session and blocks the later one'
);
select is(
  (select count(*)::integer from public.payment_attempts where job_id = 'c1430000-0000-4000-8000-000000000105'),
  1,
  'the late session does not add a payment attempt'
);

select * from finish();
rollback;
