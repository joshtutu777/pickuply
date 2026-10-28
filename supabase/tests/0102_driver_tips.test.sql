-- Tips stay separate from the booking. One successful tip per job.

begin;

select plan(20);

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
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    email, 'test-hash', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now(), uid::text, '', uid::text || '-email', uid::text || '-recovery'
  );
end;
$$;

select pg_temp.make_user('c1020000-0000-4000-8000-000000000001', 'tip-customer@pickuply.test');
select pg_temp.make_user('c1020000-0000-4000-8000-000000000002', 'tip-driver@pickuply.test');
select pg_temp.make_user('c1020000-0000-4000-8000-000000000003', 'tip-other@pickuply.test');
select pg_temp.make_user('c1020000-0000-4000-8000-000000000004', 'tip-admin@pickuply.test');
update public.profiles set full_name = 'Sam Customer' where id = 'c1020000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'Ada Driver' where id = 'c1020000-0000-4000-8000-000000000002';
update public.profiles set role = 'admin', full_name = 'Tip Admin' where id = 'c1020000-0000-4000-8000-000000000004';

insert into public.drivers (
  profile_id, status, home_city, home_zip, license_url, license_expires, terms_version, terms_accepted_at, agreement_signed_at, is_online
) values (
  'c1020000-0000-4000-8000-000000000002', 'active', 'Austell', '30106',
  'c1020000-0000-4000-8000-000000000002/license.jpg', current_date + 30, 'driver-terms-v1', now(), now(), true
);

insert into public.driver_connect_accounts (driver_id, stripe_account_id, payouts_enabled, charges_enabled, details_submitted)
values ('c1020000-0000-4000-8000-000000000002', 'acct_tip0102test', true, true, true);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents
) values (
  'c1020000-0000-4000-8000-000000000010',
  'c1020000-0000-4000-8000-000000000001',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'tip job', 1, 'medium', 0, 0, false, false, 'asap', 'quote',
  10500, 8500, 1500, 500
);

select pg_temp.as_user('c1020000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.begin_tip('c1020000-0000-4000-8000-000000000010', 1000)$$,
  'a tip is available after the job is completed',
  'a tip is refused before completion'
);

set session_replication_role = replica;
update public.jobs
set status = 'completed',
    completed_at = now(),
    updated_at = now(),
    assigned_driver_id = 'c1020000-0000-4000-8000-000000000002'
where id = 'c1020000-0000-4000-8000-000000000010';
set session_replication_role = origin;

select throws_ok(
  $$select public.begin_tip('c1020000-0000-4000-8000-000000000010', 50)$$,
  'a tip must be from $1 to $200',
  'a tip under $1 is refused'
);
select throws_ok(
  $$select public.begin_tip('c1020000-0000-4000-8000-000000000010', 20001)$$,
  'a tip must be from $1 to $200',
  'a tip over $200 is refused'
);

select pg_temp.as_user('c1020000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.begin_tip('c1020000-0000-4000-8000-000000000010', 1000)$$,
  'only the customer can tip',
  'another customer cannot tip this job'
);

select pg_temp.as_user('c1020000-0000-4000-8000-000000000001');
select is(
  (public.begin_tip('c1020000-0000-4000-8000-000000000010', 1000)->>'amount_cents')::int,
  1000,
  'a $10 tip can be started'
);
select is(
  (public.begin_tip('c1020000-0000-4000-8000-000000000010', 1000)->>'tip_id'),
  (select id::text from public.job_tips where job_id = 'c1020000-0000-4000-8000-000000000010' and status = 'pending'),
  'the same unpaid tip is reused'
);

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select is(
  public.confirm_tip_payment(
    (select id from public.job_tips where job_id = 'c1020000-0000-4000-8000-000000000010'),
    'pi_tip0102',
    'ch_tip0102',
    59,
    false
  ),
  'paid',
  'Stripe confirmation marks the tip paid'
);
select is(
  public.confirm_tip_payment(
    (select id from public.job_tips where job_id = 'c1020000-0000-4000-8000-000000000010'),
    'pi_tip0102',
    'ch_tip0102',
    59,
    false
  ),
  'duplicate',
  'a repeated confirmation does not add a second tip'
);
reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select amount_cents from public.ledger_entries where tip_id = (
    select id from public.job_tips where job_id = 'c1020000-0000-4000-8000-000000000010'
  )),
  1000,
  'the driver ledger receives the whole tip'
);
select is(
  (select entry_kind from public.ledger_entries where job_id = 'c1020000-0000-4000-8000-000000000010' and entry_kind = 'tip'),
  'tip',
  'the tip is not the base earning'
);

select pg_temp.as_user('c1020000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.begin_tip('c1020000-0000-4000-8000-000000000010', 500)$$,
  'this job already has a tip',
  'a second tip is refused after the first succeeds'
);

insert into public.ledger_entries (job_id, driver_id, amount_cents, status, available_on, entry_kind)
values (
  'c1020000-0000-4000-8000-000000000010',
  'c1020000-0000-4000-8000-000000000002',
  8500, 'pending', now(), 'base'
);
select public.refresh_ledger_readiness();
select is(
  (select status from public.ledger_entries where job_id = 'c1020000-0000-4000-8000-000000000010' and entry_kind = 'tip'),
  'ready',
  'a new driver tip does not wait 48 hours'
);
select is(
  (select status from public.ledger_entries where job_id = 'c1020000-0000-4000-8000-000000000010' and entry_kind = 'base'),
  'pending',
  'base earnings for a new driver still wait'
);

insert into public.card_disputes (stripe_dispute_id, job_id, amount_cents, status)
values ('du_tip0102', 'c1020000-0000-4000-8000-000000000010', 1000, 'needs_response');
select public.refresh_ledger_readiness();
select is(
  (select status from public.ledger_entries where job_id = 'c1020000-0000-4000-8000-000000000010' and entry_kind = 'tip'),
  'held',
  'an open card dispute holds the tip'
);
delete from public.card_disputes where stripe_dispute_id = 'du_tip0102';

select pg_temp.as_user('c1020000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.begin_tip_refund((select id from public.job_tips where job_id = 'c1020000-0000-4000-8000-000000000010'), 1000, 'customer refund')$$,
  'only an admin can refund a tip',
  'a customer cannot refund a tip'
);

select pg_temp.as_user('c1020000-0000-4000-8000-000000000004');
select lives_ok(
  $$select public.begin_tip_refund((select id from public.job_tips where job_id = 'c1020000-0000-4000-8000-000000000010'), 400, 'admin partial')$$,
  'an admin can start a partial tip refund'
);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.apply_tip_refund(
  (select id from public.tip_refunds where reason = 'admin partial'),
  're_tip0102',
  true
);
select public.apply_tip_refund(
  (select id from public.tip_refunds where reason = 'admin partial'),
  're_tip0102',
  true
);
reset role;
select is(
  (select refunded_cents from public.job_tips where job_id = 'c1020000-0000-4000-8000-000000000010'),
  400,
  'a repeated refund event does not refund the tip twice'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  completed_at
) values (
  'c1020000-0000-4000-8000-000000000011',
  'c1020000-0000-4000-8000-000000000001',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'old tip job', 1, 'medium', 0, 0, false, false, 'asap', 'quote',
  now() - interval '8 days'
);
set session_replication_role = replica;
update public.jobs
set status = 'completed',
    completed_at = now() - interval '8 days',
    assigned_driver_id = 'c1020000-0000-4000-8000-000000000002'
where id = 'c1020000-0000-4000-8000-000000000011';
set session_replication_role = origin;
select pg_temp.as_user('c1020000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.begin_tip('c1020000-0000-4000-8000-000000000011', 1000)$$,
  'the tip window has closed',
  'a tip after seven days is refused'
);

set session_replication_role = replica;
update public.jobs
set payment_status = 'captured',
    captured_cents = 10500,
    price_cents = 10500,
    service_fee_cents = 500
where id = 'c1020000-0000-4000-8000-000000000010';
set session_replication_role = origin;
select public.apply_refund_to_job('c1020000-0000-4000-8000-000000000010', 2000, 'booking refund');
select is(
  (select amount_cents from public.ledger_entries where job_id = 'c1020000-0000-4000-8000-000000000010' and entry_kind = 'base'),
  6500,
  'a booking refund reduces only the base earning'
);
select is(
  (select amount_cents from public.ledger_entries where job_id = 'c1020000-0000-4000-8000-000000000010' and entry_kind = 'tip'),
  600,
  'a booking refund leaves the tip ledger unchanged'
);

select * from finish();
rollback;
