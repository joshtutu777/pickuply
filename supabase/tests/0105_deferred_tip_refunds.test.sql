-- A tip refund event that arrives before its row is stored once and applied once.

begin;

select plan(8);

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

select pg_temp.make_user('c1050000-0000-4000-8000-000000000001', 'defer-customer@pickuply.test');
select pg_temp.make_user('c1050000-0000-4000-8000-000000000002', 'defer-driver@pickuply.test');
update public.profiles set full_name = 'Sam Customer' where id = 'c1050000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'Ada Driver' where id = 'c1050000-0000-4000-8000-000000000002';

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents
) values
  ('c1050000-0000-4000-8000-000000000010', 'c1050000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'deferred refund', 1, 'medium', 0, 0, false, false, 'asap', 'quote', 10500, 8500, 1500, 500),
  ('c1050000-0000-4000-8000-000000000011', 'c1050000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'mismatched refund', 1, 'medium', 0, 0, false, false, 'asap', 'quote', 10500, 8500, 1500, 500);

set session_replication_role = replica;
update public.jobs
set status = 'completed', completed_at = now(), updated_at = now(), assigned_driver_id = 'c1050000-0000-4000-8000-000000000002'
where id in ('c1050000-0000-4000-8000-000000000010', 'c1050000-0000-4000-8000-000000000011');
set session_replication_role = origin;

select pg_temp.as_user('c1050000-0000-4000-8000-000000000001');
select public.begin_tip('c1050000-0000-4000-8000-000000000010', 1000);
select public.begin_tip('c1050000-0000-4000-8000-000000000011', 1000);

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.confirm_tip_payment(
  (select id from public.job_tips where job_id = 'c1050000-0000-4000-8000-000000000010'),
  'pi_tip0105', 'ch_tip0105', 59, false
);
select public.confirm_tip_payment(
  (select id from public.job_tips where job_id = 'c1050000-0000-4000-8000-000000000011'),
  'pi_tip0105b', 'ch_tip0105b', 59, false
);
select is(
  public.defer_tip_refund('c1050000-0000-4000-8000-0000000000b1', 're_tip0105early', 400, true),
  'deferred',
  'a refund event is kept when its row does not exist yet'
);
select is(
  public.defer_tip_refund('c1050000-0000-4000-8000-0000000000b1', 're_tip0105early', 400, true),
  'deferred',
  'saving the same early refund again does not create a second one'
);
reset role;

select is(
  (select amount_cents from public.ledger_entries where tip_id = (select id from public.job_tips where job_id = 'c1050000-0000-4000-8000-000000000010')),
  1000,
  'the driver ledger stays whole until the refund row exists'
);

insert into public.tip_refunds (id, tip_id, amount_cents, reason, status, created_by)
values (
  'c1050000-0000-4000-8000-0000000000b1',
  (select id from public.job_tips where job_id = 'c1050000-0000-4000-8000-000000000010'),
  400, 'arrived later', 'pending', 'c1050000-0000-4000-8000-000000000001'
);

select is(
  (select amount_cents from public.ledger_entries where tip_id = (select id from public.job_tips where job_id = 'c1050000-0000-4000-8000-000000000010')),
  600,
  'the saved refund is applied once when the row arrives'
);
select is(
  (select refunded_cents from public.job_tips where job_id = 'c1050000-0000-4000-8000-000000000010'),
  400,
  'the tip records the refund once'
);

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select is(
  public.defer_tip_refund('c1050000-0000-4000-8000-0000000000b1', 're_tip0105early', 400, true),
  'duplicate',
  'a replay after the refund is applied does not change it again'
);
select public.defer_tip_refund('c1050000-0000-4000-8000-0000000000b2', 're_tip0105mismatch', 400, true);
reset role;

insert into public.tip_refunds (id, tip_id, amount_cents, reason, status, created_by)
values (
  'c1050000-0000-4000-8000-0000000000b2',
  (select id from public.job_tips where job_id = 'c1050000-0000-4000-8000-000000000011'),
  200, 'different amount', 'pending', 'c1050000-0000-4000-8000-000000000001'
);

select is(
  (select refunded_cents from public.job_tips where job_id = 'c1050000-0000-4000-8000-000000000011'),
  0,
  'a different refund amount is not applied to the ledger'
);
select is(
  (select applied_at is null from public.deferred_tip_refunds where stripe_refund_id = 're_tip0105mismatch'),
  true,
  'the mismatched refund stays unapplied for review'
);

select * from finish();
rollback;
