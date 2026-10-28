-- Local only. The reconciliation report is read-only and admin-only.

begin;

select plan(4);

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

select pg_temp.make_user('c0990000-0000-4000-8000-000000000001', 'recon-customer@pickuply.test');
select pg_temp.make_user('c0990000-0000-4000-8000-000000000002', 'recon-driver@pickuply.test');
select pg_temp.make_user('c0990000-0000-4000-8000-000000000003', 'recon-admin@pickuply.test');
update public.profiles set role = 'admin', full_name = 'Recon Admin' where id = 'c0990000-0000-4000-8000-000000000003';

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date,
  pricing_method, service_level, required_vehicle
) values (
  'c0990000-0000-4000-8000-000000000031', 'c0990000-0000-4000-8000-000000000001',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'reconciliation job', 1, 'medium', 0, 0, false, false, 'asap',
  'fixed', 'full', 'pickup'
);

update public.jobs
set status = 'completed',
    payment_status = 'captured',
    price_cents = 7000,
    driver_pay_cents = 5950,
    platform_fee_cents = 1050,
    service_fee_cents = 233,
    captured_cents = 7233,
    refunded_cents = 0
where id = 'c0990000-0000-4000-8000-000000000031';

select ok(
  exists (
    select 1 from public.payment_reconciliation_issues()
    where job_id = 'c0990000-0000-4000-8000-000000000031'
      and issue = 'captured payment has no driver earnings'
  ),
  'a captured job without a ledger row is reported'
);

select pg_temp.as_user('c0990000-0000-4000-8000-000000000001');
select is(
  (select count(*) from public.payment_reconciliation_issues()),
  0::bigint,
  'a customer cannot read the reconciliation report'
);

select set_config('request.jwt.claim.sub', '', true);
select pg_temp.as_user('c0990000-0000-4000-8000-000000000003');
select ok(
  exists (
    select 1 from public.payment_reconciliation_issues()
    where job_id = 'c0990000-0000-4000-8000-000000000031'
  ),
  'an admin can read the reconciliation report'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

insert into public.ledger_entries (id, job_id, driver_id, amount_cents, status, stripe_transfer_id, transfer_status)
values (
  'c0990000-0000-4000-8000-000000000041',
  'c0990000-0000-4000-8000-000000000031',
  'c0990000-0000-4000-8000-000000000002',
  5950,
  'transferred',
  'tr_recon099',
  'created'
);

select is(
  (
    select count(*) from public.payment_reconciliation_issues()
    where job_id = 'c0990000-0000-4000-8000-000000000031'
      and issue = 'captured payment has no driver earnings'
  ),
  0::bigint,
  'recording the ledger row clears that finding'
);

select * from finish();
rollback;
