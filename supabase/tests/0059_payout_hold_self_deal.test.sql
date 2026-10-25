-- Local only. A new driver waits 48 hours. A person cannot take their own job.

begin;

select plan(5);

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
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

create or replace function pg_temp.clear_auth()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
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

select pg_temp.make_user('c1590000-0000-4000-8000-000000000001', 'hold-customer@pickuply.test');
select pg_temp.make_user('c1590000-0000-4000-8000-000000000002', 'hold-driver@pickuply.test');
select pg_temp.make_user('c1590000-0000-4000-8000-000000000003', 'hold-both@pickuply.test');

update public.profiles set role = 'driver', full_name = 'Hold Driver' where id = 'c1590000-0000-4000-8000-000000000002';
update public.profiles set role = 'driver', full_name = 'Hold Both' where id = 'c1590000-0000-4000-8000-000000000003';

insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online)
values
  (
    'c1590000-0000-4000-8000-000000000002', 'active',
    (select id from public.zones where slug = 'west_metro'),
    'full', array['delivery']::public.job_service[], true
  ),
  (
    'c1590000-0000-4000-8000-000000000003', 'active',
    (select id from public.zones where slug = 'west_metro'),
    'full', array['delivery']::public.job_service[], true
  );

insert into public.driver_connect_accounts (driver_id, stripe_account_id, payouts_enabled)
values ('c1590000-0000-4000-8000-000000000002', 'acct_holdtest0001', true);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method
) values (
  'c1590000-0000-4000-8000-000000000011', 'c1590000-0000-4000-8000-000000000001',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'hold job', 1, 'medium', 0, 0, false, false, 'asap', 'fixed'
), (
  'c1590000-0000-4000-8000-000000000012', 'c1590000-0000-4000-8000-000000000003',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'own job', 1, 'medium', 0, 0, false, false, 'asap', 'fixed'
);

update public.jobs
set status = 'completed',
    assigned_driver_id = 'c1590000-0000-4000-8000-000000000002',
    payment_status = 'captured',
    captured_cents = 5000
where id = 'c1590000-0000-4000-8000-000000000011';

insert into public.ledger_entries (job_id, driver_id, amount_cents, status, available_on)
values (
  'c1590000-0000-4000-8000-000000000011',
  'c1590000-0000-4000-8000-000000000002',
  4000,
  'pending',
  now() - interval '2 days'
);

select public.refresh_ledger_readiness();

select results_eq(
  $$select status::text, hold_reason from public.ledger_entries where job_id = 'c1590000-0000-4000-8000-000000000011'$$,
  $$values ('pending', 'Earnings stay held for 48 hours after a new driver finishes a job')$$,
  'a new driver is not ready for transfer in the first 48 hours'
);

set local session_replication_role = replica;
update public.jobs
set updated_at = now() - interval '49 hours'
where id = 'c1590000-0000-4000-8000-000000000011';
set local session_replication_role = origin;

select public.refresh_ledger_readiness();

select results_eq(
  $$select status::text from public.ledger_entries where job_id = 'c1590000-0000-4000-8000-000000000011'$$,
  $$values ('ready')$$,
  'a new driver becomes ready after 48 elapsed hours'
);

select pg_temp.as_user('c1590000-0000-4000-8000-000000000003');
set local role authenticated;

select is_empty(
  $$select id from public.driver_matched_feed() where id = 'c1590000-0000-4000-8000-000000000012'
    union all
    select id from public.driver_georgia_page(50, 0) where id = 'c1590000-0000-4000-8000-000000000012'$$,
  'a driver does not see their own request'
);

select throws_ok(
  $$select public.submit_offer('c1590000-0000-4000-8000-000000000012', 'accept', 3500, null)$$,
  'this driver cannot offer on this job',
  'a driver cannot offer on their own request'
);

reset role;

select is(
  public.driver_is_eligible_for_job('c1590000-0000-4000-8000-000000000012'),
  false,
  'eligibility rejects the requester'
);

select * from finish();
rollback;
