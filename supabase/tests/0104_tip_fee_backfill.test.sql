-- A later confirmation fills a missing Stripe fee and does not add earnings.

begin;

select plan(3);

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

select pg_temp.make_user('c1040000-0000-4000-8000-000000000001', 'fee-tip-customer@pickuply.test');
select pg_temp.make_user('c1040000-0000-4000-8000-000000000002', 'fee-tip-driver@pickuply.test');
update public.profiles set full_name = 'Sam Customer' where id = 'c1040000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'Ada Driver' where id = 'c1040000-0000-4000-8000-000000000002';

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents
) values (
  'c1040000-0000-4000-8000-000000000010',
  'c1040000-0000-4000-8000-000000000001',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'fee backfill', 1, 'medium', 0, 0, false, false, 'asap', 'quote',
  10500, 8500, 1500, 500
);

set session_replication_role = replica;
update public.jobs
set status = 'completed', completed_at = now(), updated_at = now(), assigned_driver_id = 'c1040000-0000-4000-8000-000000000002'
where id = 'c1040000-0000-4000-8000-000000000010';
set session_replication_role = origin;

select pg_temp.as_user('c1040000-0000-4000-8000-000000000001');
select public.begin_tip('c1040000-0000-4000-8000-000000000010', 1000);

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.confirm_tip_payment(
  (select id from public.job_tips where job_id = 'c1040000-0000-4000-8000-000000000010'),
  'pi_tip0104', 'ch_tip0104', null, false
);
select is(
  public.confirm_tip_payment(
    (select id from public.job_tips where job_id = 'c1040000-0000-4000-8000-000000000010'),
    'pi_tip0104', 'ch_tip0104', 59, false
  ),
  'duplicate',
  'a repeated confirmation does not count as a new payment'
);
reset role;

select is(
  (select stripe_fee_cents from public.job_tips where job_id = 'c1040000-0000-4000-8000-000000000010'),
  59,
  'the later confirmation records the Stripe fee'
);
select is(
  (select count(*) from public.ledger_entries where tip_id = (select id from public.job_tips where job_id = 'c1040000-0000-4000-8000-000000000010')),
  1::bigint,
  'the fee update does not add a second ledger row'
);

select * from finish();
rollback;
