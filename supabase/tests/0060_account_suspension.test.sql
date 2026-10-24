-- Local only. Suspension, offer closing, request pause, deletion, and the last admin.

begin;

select plan(12);

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
end;
$$;

create or replace function pg_temp.make_user(uid uuid, email text)
returns void language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    email, 'test-hash', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now(), now(), uid::text, '', uid::text || '-email', uid::text || '-recovery'
  );
end;
$$;

select pg_temp.make_user('c1600000-0000-4000-8000-000000000001', 'sus-customer@pickuply.test');
select pg_temp.make_user('c1600000-0000-4000-8000-000000000002', 'sus-driver@pickuply.test');
select pg_temp.make_user('c1600000-0000-4000-8000-000000000003', 'sus-admin@pickuply.test');
select pg_temp.make_user('c1600000-0000-4000-8000-000000000004', 'sus-admin2@pickuply.test');

update public.profiles set role = 'driver', full_name = 'Sus Driver', phone = '5555550191' where id = 'c1600000-0000-4000-8000-000000000002';
update public.profiles set role = 'admin', full_name = 'Sus Admin' where id = 'c1600000-0000-4000-8000-000000000003';
update public.profiles set role = 'admin', full_name = 'Sus Admin Two' where id = 'c1600000-0000-4000-8000-000000000004';
update public.profiles set role = 'customer'
where role = 'admin'
  and id not in (
    'c1600000-0000-4000-8000-000000000003',
    'c1600000-0000-4000-8000-000000000004'
  );
update public.profiles set full_name = 'Sus Customer', phone = '5555550192' where id = 'c1600000-0000-4000-8000-000000000001';
update auth.users set phone = '15555550192' where id = 'c1600000-0000-4000-8000-000000000001';
update auth.users set phone = '15555550191' where id = 'c1600000-0000-4000-8000-000000000002';

insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online)
values (
  'c1600000-0000-4000-8000-000000000002', 'active',
  (select id from public.zones where slug = 'west_metro'),
  'full', array['delivery']::public.job_service[], true
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values (
  'c1600000-0000-4000-8000-000000000011', 'c1600000-0000-4000-8000-000000000001',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'open request', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000
), (
  'c1600000-0000-4000-8000-000000000012', 'c1600000-0000-4000-8000-000000000001',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'booked', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000
);

update public.jobs
set status = 'assigned',
    assigned_driver_id = 'c1600000-0000-4000-8000-000000000002',
    payment_status = 'authorized'
where id = 'c1600000-0000-4000-8000-000000000012';

insert into public.job_offers (
  job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents,
  customer_total_cents, status, expires_at
) values (
  'c1600000-0000-4000-8000-000000000011', 'c1600000-0000-4000-8000-000000000002',
  'accept', 5000, 0, 0, 5000, 'active', now() + interval '1 day'
);

select pg_temp.as_user('c1600000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.suspend_account('c1600000-0000-4000-8000-000000000002', 'indefinite', 'test reason', null, null)$$,
  'only an admin can suspend an account',
  'a customer cannot suspend someone'
);

reset role;
select pg_temp.as_user('c1600000-0000-4000-8000-000000000003');
set local role authenticated;

select throws_ok(
  $$select public.suspend_account('c1600000-0000-4000-8000-000000000003', 'indefinite', 'self', null, null)$$,
  'an admin cannot suspend their own account',
  'an admin cannot suspend themselves'
);

select lives_ok(
  $$select public.suspend_account('c1600000-0000-4000-8000-000000000002', 'indefinite', 'missed pickups', null, 'internal')$$,
  'an admin can suspend a driver'
);

select is_empty(
  $$select id from public.job_offers where driver_id = 'c1600000-0000-4000-8000-000000000002' and status = 'active'$$,
  'unaccepted offers are no longer active'
);

select results_eq(
  $$select status::text from public.jobs where id = 'c1600000-0000-4000-8000-000000000012'$$,
  $$values ('assigned')$$,
  'an accepted booking is not cancelled'
);

select lives_ok(
  $$select public.suspend_account('c1600000-0000-4000-8000-000000000001', 'temporary', 'open requests', now() + interval '2 days', null)$$,
  'an admin can suspend a customer'
);

select results_eq(
  $$select suspension_hold from public.jobs where id = 'c1600000-0000-4000-8000-000000000011'$$,
  $$values (true)$$,
  'the open request is paused for the suspension'
);

select lives_ok(
  $$select public.suspend_account('c1600000-0000-4000-8000-000000000004', 'indefinite', 'second admin', null, null)$$,
  'one of two admins can be suspended'
);

reset role;
select pg_temp.as_user('c1600000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.suspend_account('c1600000-0000-4000-8000-000000000003', 'indefinite', 'lockout', null, null)$$,
  'the last active admin cannot be suspended',
  'a suspended admin cannot remove the last active admin'
);

reset role;
select pg_temp.as_user('c1600000-0000-4000-8000-000000000003');
set local role authenticated;

select lives_ok(
  $$select public.reinstate_account('c1600000-0000-4000-8000-000000000001')$$,
  'the customer can be reinstated'
);

select is(
  (select paused_at is null from public.jobs where id = 'c1600000-0000-4000-8000-000000000011'),
  true,
  'a still-open request is visible again'
);

select is(
  (select status::text from public.job_offers where job_id = 'c1600000-0000-4000-8000-000000000011'),
  'expired',
  'a closed offer stays closed after reinstatement'
);

select * from finish();
rollback;
