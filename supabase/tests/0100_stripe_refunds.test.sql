-- Local only. A Dashboard refund updates the ledger once and does not reverse a transfer.

begin;

select plan(8);

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
    execute format('grant execute on all functions in schema %I to anon, authenticated, service_role', sch);
  end loop;
end $$;

create or replace function pg_temp.as_user(uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
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

select pg_temp.make_user('c1000000-0000-4000-8000-000000000001', 'refund-customer@pickuply.test');
select pg_temp.make_user('c1000000-0000-4000-8000-000000000002', 'refund-driver@pickuply.test');

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date,
  pricing_method, service_level, required_vehicle
) values (
  'c1000000-0000-4000-8000-000000000031', 'c1000000-0000-4000-8000-000000000001',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'dashboard refund', 1, 'medium', 0, 0, false, false, 'asap',
  'fixed', 'full', 'pickup'
);

update public.jobs
set status = 'completed',
    payment_status = 'captured',
    price_cents = 10000,
    driver_pay_cents = 8500,
    platform_fee_cents = 1500,
    service_fee_cents = 320,
    captured_cents = 10320,
    refunded_cents = 0
where id = 'c1000000-0000-4000-8000-000000000031';

insert into public.job_payments (job_id, charge_id, payment_intent_id)
values (
  'c1000000-0000-4000-8000-000000000031',
  'ch_refund0100',
  'pi_refund0100'
);

insert into public.ledger_entries (id, job_id, driver_id, amount_cents, status)
values (
  'c1000000-0000-4000-8000-000000000041',
  'c1000000-0000-4000-8000-000000000031',
  'c1000000-0000-4000-8000-000000000002',
  8500,
  'pending'
);

set local role service_role;
select public.record_stripe_refund('c1000000-0000-4000-8000-000000000031', 're_dash0100a', 2000, false);
select public.record_stripe_refund('c1000000-0000-4000-8000-000000000031', 're_dash0100a', 2000, true);
select public.record_stripe_refund('c1000000-0000-4000-8000-000000000031', 're_dash0100a', 2000, true);
select public.record_stripe_refund('c1000000-0000-4000-8000-000000000031', 're_dash0100b', 1500, true);
reset role;

select is(
  (select refunded_cents from public.jobs where id = 'c1000000-0000-4000-8000-000000000031'),
  3500,
  'a failed refund does not count and a repeated success counts once'
);
select is(
  (select amount_cents from public.ledger_entries where job_id = 'c1000000-0000-4000-8000-000000000031'),
  5000,
  'partial refunds before transfer reduce driver earnings'
);
select is(
  (select count(*) from public.recovery_obligations where job_id = 'c1000000-0000-4000-8000-000000000031'),
  0::bigint,
  'a refund before transfer does not create a recovery'
);

update public.ledger_entries
set status = 'transferred', stripe_transfer_id = 'tr_refund0100', transfer_status = 'created'
where job_id = 'c1000000-0000-4000-8000-000000000031';

set local role service_role;
select public.record_stripe_refund('c1000000-0000-4000-8000-000000000031', 're_dash0100c', 1000, true);
select public.record_stripe_refund('c1000000-0000-4000-8000-000000000031', 're_dash0100c', 1000, true);
reset role;

select is(
  (select amount_cents from public.ledger_entries where job_id = 'c1000000-0000-4000-8000-000000000031'),
  5000,
  'a refund after transfer leaves the paid earnings in place'
);
select is(
  (select count(*) from public.recovery_obligations where job_id = 'c1000000-0000-4000-8000-000000000031' and amount_cents = 1000),
  1::bigint,
  'a refund after transfer records one recovery and does not claw it back'
);
select is(
  (select refunded_cents from public.jobs where id = 'c1000000-0000-4000-8000-000000000031'),
  4500,
  'the customer refund total includes the later partial refund'
);

select pg_temp.as_user('c1000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.record_stripe_refund('c1000000-0000-4000-8000-000000000031', 're_dash0100d', 100, true)$$,
  '42501',
  'permission denied for function record_stripe_refund',
  'a customer cannot record a Stripe refund'
);
reset role;

select set_config('request.jwt.claim.sub', '', true);
set local role service_role;
select throws_ok(
  $$select public.record_stripe_refund('c1000000-0000-4000-8000-000000000031', 're_dash0100e', 99999, true)$$,
  'P0001',
  'that refund is larger than the remaining charge',
  'a refund larger than the remaining charge is refused'
);
reset role;

select * from finish();
rollback;
