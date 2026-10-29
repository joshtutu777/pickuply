-- A real driver sees an empty feed when the only open job is synthetic.
-- Local only. Do not apply this file to the hosted database.

begin;

select plan(11);

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
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.clear_auth()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
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

select set_config('pickuply.phone_hmac_secret', 'local-test-secret', true);
select pg_temp.make_user('c1930000-0000-4000-8000-000000000001', 'empty-real-customer@pickuply.test');
select pg_temp.make_user('c1930000-0000-4000-8000-000000000002', 'empty-real-driver@pickuply.test');
select pg_temp.make_user('c1930000-0000-4000-8000-000000000003', 'empty-test-customer@pickuply.test');
select pg_temp.make_user('c1930000-0000-4000-8000-000000000004', 'empty-test-driver@pickuply.test');
select pg_temp.make_user('c1930000-0000-4000-8000-000000000005', 'empty-real-admin@pickuply.test');
select pg_temp.make_user('c1930000-0000-4000-8000-000000000006', 'empty-test-admin@pickuply.test');

select pg_temp.clear_auth();
update public.platform_settings set waves_enabled = false where id = 1;
update public.profiles set full_name = 'Real Customer' where id = 'c1930000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'Real Driver' where id = 'c1930000-0000-4000-8000-000000000002';
update public.profiles set full_name = 'Test Customer', is_test = true where id = 'c1930000-0000-4000-8000-000000000003';
update public.profiles set role = 'driver', full_name = 'Test Driver', is_test = true where id = 'c1930000-0000-4000-8000-000000000004';
update public.profiles set role = 'admin', full_name = 'Real Admin' where id = 'c1930000-0000-4000-8000-000000000005';
update public.profiles set role = 'admin', full_name = 'Test Admin', is_test = true where id = 'c1930000-0000-4000-8000-000000000006';

insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online)
values
  ('c1930000-0000-4000-8000-000000000002', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], true),
  ('c1930000-0000-4000-8000-000000000004', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], true);

insert into public.driver_feed_filters (profile_id, cities)
values
  ('c1930000-0000-4000-8000-000000000002', array['Austell']),
  ('c1930000-0000-4000-8000-000000000004', array['Austell']);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values (
  'c1930000-0000-4000-8000-000000000012', 'c1930000-0000-4000-8000-000000000003', 'delivery', 'open',
  (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'synthetic only',
  1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000
);

select pg_temp.as_user('c1930000-0000-4000-8000-000000000002');
select is(
  (select count(*)::integer from public.driver_matched_feed() where id = 'c1930000-0000-4000-8000-000000000012'),
  0,
  'a real driver sees no matched synthetic job'
);
select is(public.driver_georgia_count(), 0, 'a real driver sees no open Georgia requests when only a synthetic job exists');
select is(
  (select count(*)::integer from public.job_feed_signals where is_test),
  0,
  'a real driver does not receive the synthetic feed signal'
);
select pg_temp.clear_auth();

select pg_temp.as_user('c1930000-0000-4000-8000-000000000004');
select cmp_ok(
  (select count(*)::integer from public.driver_browse_jobs() where id = 'c1930000-0000-4000-8000-000000000012'),
  '>',
  0,
  'a synthetic driver still sees the synthetic job'
);
select pg_temp.clear_auth();

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values (
  'c1930000-0000-4000-8000-000000000011', 'c1930000-0000-4000-8000-000000000001', 'delivery', 'open',
  (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'real request',
  1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000
);

select pg_temp.as_user('c1930000-0000-4000-8000-000000000002');
select cmp_ok(
  (select count(*)::integer from public.job_feed_signals where not is_test),
  '>',
  0,
  'a real request wakes the real driver feed'
);
select is(public.driver_is_eligible_for_job('c1930000-0000-4000-8000-000000000012'), false, 'a real driver cannot take the synthetic job');
select pg_temp.clear_auth();

select pg_temp.as_user('c1930000-0000-4000-8000-000000000004');
select is(public.driver_is_eligible_for_job('c1930000-0000-4000-8000-000000000011'), false, 'a synthetic driver cannot take a real job');
select pg_temp.clear_auth();

select throws_ok(
  $$insert into public.job_offers (job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents, customer_total_cents, status, expires_at)
    values ('c1930000-0000-4000-8000-000000000011', 'c1930000-0000-4000-8000-000000000004', 'accept', 5000, 0, 0, 5000, 'active', now() + interval '1 day')$$,
  'test and real accounts cannot be booked together',
  'a synthetic driver cannot offer on a real job'
);

insert into public.job_offers (
  job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents, customer_total_cents, status, expires_at
) values (
  'c1930000-0000-4000-8000-000000000012', 'c1930000-0000-4000-8000-000000000004',
  'accept', 5000, 0, 0, 5000, 'active', now() + interval '1 day'
);

insert into public.message_threads (id, job_id, requester_id, driver_id, kind)
values (
  'c1930000-0000-4000-8000-000000000021',
  'c1930000-0000-4000-8000-000000000012',
  'c1930000-0000-4000-8000-000000000003',
  'c1930000-0000-4000-8000-000000000004',
  'job'
);
insert into public.messages (thread_id, sender_id, body)
values ('c1930000-0000-4000-8000-000000000021', 'c1930000-0000-4000-8000-000000000003', 'The couch is ready');

select pg_temp.as_user('c1930000-0000-4000-8000-000000000001');
select is(
  (select count(*)::integer from public.job_offers where job_id = 'c1930000-0000-4000-8000-000000000012'),
  0,
  'a real customer cannot see a synthetic offer'
);
select is(
  (select count(*)::integer from public.messages where thread_id = 'c1930000-0000-4000-8000-000000000021'),
  0,
  'a real customer cannot see a synthetic message'
);
select pg_temp.clear_auth();

select is(
  (select count(*)::integer from public.notifications n
    join public.profiles p on p.id = n.profile_id
    where n.job_id = 'c1930000-0000-4000-8000-000000000012' and not p.is_test),
  0,
  'a synthetic request does not alert a real account'
);

select * from finish();
rollback;
