-- Local only. One ledger row can win a single transfer send, and the same Stripe transfer cannot be reused.

begin;

select plan(10);

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

select pg_temp.make_user('c1010000-0000-4000-8000-000000000001', 'transfer-customer@pickuply.test');
select pg_temp.make_user('c1010000-0000-4000-8000-000000000002', 'transfer-driver@pickuply.test');

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date,
  pricing_method, service_level, required_vehicle
) values
  (
    'c1010000-0000-4000-8000-000000000031', 'c1010000-0000-4000-8000-000000000001',
    'delivery', 'completed', (select id from public.zones where slug = 'west_metro'),
    'Austell 30168', 'transfer claim', 1, 'medium', 0, 0, false, false, 'asap',
    'fixed', 'full', 'pickup'
  ),
  (
    'c1010000-0000-4000-8000-000000000032', 'c1010000-0000-4000-8000-000000000001',
    'delivery', 'completed', (select id from public.zones where slug = 'west_metro'),
    'Austell 30168', 'transfer other', 1, 'medium', 0, 0, false, false, 'asap',
    'fixed', 'full', 'pickup'
  );

insert into public.ledger_entries (id, job_id, driver_id, amount_cents, status) values
  ('c1010000-0000-4000-8000-000000000041', 'c1010000-0000-4000-8000-000000000031', 'c1010000-0000-4000-8000-000000000002', 8500, 'ready'),
  ('c1010000-0000-4000-8000-000000000042', 'c1010000-0000-4000-8000-000000000032', 'c1010000-0000-4000-8000-000000000002', 8500, 'ready');

set local role service_role;
select is(
  (public.begin_transfer_send('c1010000-0000-4000-8000-000000000041')->>'action'),
  'send',
  'the first caller may create the transfer'
);
select is(
  (public.begin_transfer_send('c1010000-0000-4000-8000-000000000041')->>'action'),
  'lookup',
  'a second caller does not create another transfer'
);
select is(
  (public.begin_transfer_send('c1010000-0000-4000-8000-000000000041')->>'idempotency_key'),
  'c1010000-0000-4000-8000-000000000041',
  'the idempotency key stays the ledger id'
);
select public.note_transfer_unknown('c1010000-0000-4000-8000-000000000041');
select is(
  (public.begin_transfer_send('c1010000-0000-4000-8000-000000000041')->>'action'),
  'lookup',
  'a lost response is not sent again until Stripe is checked'
);
select is(
  (public.begin_transfer_send('c1010000-0000-4000-8000-000000000041', true)->>'action'),
  'send',
  'a checked retry uses the same idempotency key'
);
select public.record_claimed_transfer('c1010000-0000-4000-8000-000000000041', 'tr_claim0101');
select public.record_claimed_transfer('c1010000-0000-4000-8000-000000000041', 'tr_claim0101');
reset role;

select is(
  (select stripe_transfer_id from public.ledger_entries where id = 'c1010000-0000-4000-8000-000000000041'),
  'tr_claim0101',
  'the transfer id is stored once on the ledger'
);
select is(
  (public.begin_transfer_send('c1010000-0000-4000-8000-000000000041')->>'action'),
  'recorded',
  'a recorded transfer is not sent again'
);

set local role service_role;
select throws_ok(
  $$select public.record_claimed_transfer('c1010000-0000-4000-8000-000000000042', 'tr_claim0101')$$,
  'P0001',
  'that transfer belongs to another ledger row',
  'another ledger row cannot take the same transfer'
);
select public.begin_transfer_send('c1010000-0000-4000-8000-000000000042');
select public.note_transfer_unknown('c1010000-0000-4000-8000-000000000042');
reset role;
update public.stripe_transfer_claims
set updated_at = now() - interval '24 hours'
where ledger_id = 'c1010000-0000-4000-8000-000000000042';
set local role service_role;
select is(
  (public.begin_transfer_send('c1010000-0000-4000-8000-000000000042', true)->>'action'),
  'reconcile',
  'an old unresolved attempt is not sent again'
);
reset role;

select pg_temp.as_user('c1010000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.begin_transfer_send('c1010000-0000-4000-8000-000000000041')$$,
  '42501',
  'permission denied for function begin_transfer_send',
  'a customer cannot start a transfer'
);
reset role;

select * from finish();
rollback;
