-- Local only. Announcement audiences, scheduling, and one execution.

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

select set_config('pickuply.phone_hmac_secret', 'local-test-secret', true);
select pg_temp.make_user('c1650000-0000-4000-8000-000000000001', 'ann-admin@pickuply.test');
select pg_temp.make_user('c1650000-0000-4000-8000-000000000002', 'ann-on@pickuply.test');
select pg_temp.make_user('c1650000-0000-4000-8000-000000000003', 'ann-off@pickuply.test');
select pg_temp.make_user('c1650000-0000-4000-8000-000000000004', 'ann-held@pickuply.test');
select pg_temp.make_user('c1650000-0000-4000-8000-000000000005', 'ann-customer@pickuply.test');

update public.profiles set role = 'admin' where id = 'c1650000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', phone = '5555550162' where id = 'c1650000-0000-4000-8000-000000000002';
update public.profiles set role = 'driver', phone = '5555550163' where id = 'c1650000-0000-4000-8000-000000000003';
update public.profiles set role = 'driver', phone = '5555550164' where id = 'c1650000-0000-4000-8000-000000000004';
update public.profiles set phone = '5555550165' where id = 'c1650000-0000-4000-8000-000000000005';

insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online)
values
  ('c1650000-0000-4000-8000-000000000002', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], true),
  ('c1650000-0000-4000-8000-000000000003', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], false),
  ('c1650000-0000-4000-8000-000000000004', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], true);

insert into public.driver_feed_filters (profile_id, cities)
values
  ('c1650000-0000-4000-8000-000000000002', array['Austell', 'Marietta']),
  ('c1650000-0000-4000-8000-000000000003', array['Austell']);

insert into public.account_suspensions (profile_id, status, kind, reason, created_by)
values ('c1650000-0000-4000-8000-000000000004', 'active', 'indefinite', 'test hold', 'c1650000-0000-4000-8000-000000000001');

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values
  ('c1650000-0000-4000-8000-000000000011', 'c1650000-0000-4000-8000-000000000005', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'one', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1650000-0000-4000-8000-000000000012', 'c1650000-0000-4000-8000-000000000005', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'two', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000);
update public.jobs set status = 'assigned', assigned_driver_id = 'c1650000-0000-4000-8000-000000000002', payment_status = 'authorized'
where id in ('c1650000-0000-4000-8000-000000000011', 'c1650000-0000-4000-8000-000000000012');

insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth)
values ('c1650000-0000-4000-8000-000000000002', 'https://push.example.test/device-a', 'key', 'auth');
insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, expired_at)
values ('c1650000-0000-4000-8000-000000000002', 'https://push.example.test/device-b', 'key', 'auth', now());

select is(
  (select count(*)::integer from public.announcement_recipients('{"kind":"online_drivers"}'::jsonb, 'promotional') people
    where people.profile_id in (
      'c1650000-0000-4000-8000-000000000002',
      'c1650000-0000-4000-8000-000000000003',
      'c1650000-0000-4000-8000-000000000004'
    ) and not people.suspended),
  1,
  'online drivers leave out offline and suspended drivers'
);
select is(
  (select count(*)::integer from public.announcement_recipients('{"kind":"city_drivers","city":"Austell"}'::jsonb, 'promotional') people
    where people.profile_id in (
      'c1650000-0000-4000-8000-000000000002',
      'c1650000-0000-4000-8000-000000000003'
    ) and not people.suspended),
  2,
  'a city audience uses Areas I Cover'
);
select is(
  (select count(*)::integer from public.announcement_recipients('{"kind":"city_drivers","city":"Austell","onlineOnly":true}'::jsonb, 'promotional') people
    where people.profile_id in (
      'c1650000-0000-4000-8000-000000000002',
      'c1650000-0000-4000-8000-000000000003'
    ) and not people.suspended),
  1,
  'online plus city still counts one driver'
);
select is(
  (select count(*)::integer from public.announcement_recipients('{"kind":"active_customers"}'::jsonb, 'promotional') people
    where people.profile_id = 'c1650000-0000-4000-8000-000000000005'),
  1,
  'two active bookings still count as one customer'
);
select is(
  (public.announcement_audience_preview('{"kind":"individual","ids":["c1650000-0000-4000-8000-000000000004"]}'::jsonb, 'account_support') ->> 'eligible')::integer,
  1,
  'account support can reach a suspended driver'
);

select pg_temp.as_user('c1650000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.create_admin_announcement('Later', 'A public note.', '/account/notifications', array['in_app'], '{"kind":"customers"}'::jsonb, 'promotional', now() + interval '1 day')$$,
  'an admin can schedule an announcement'
);
select lives_ok(
  $$select public.cancel_admin_announcement((select id from public.admin_announcements where title = 'Later'))$$,
  'a scheduled announcement can be cancelled'
);
select lives_ok(
  $$select public.create_admin_announcement('Now', 'Alerts are on.', '/account/notifications', array['in_app','push'], '{"kind":"online_drivers"}'::jsonb, 'promotional', null)$$,
  'an admin can queue a send'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select is(public.execute_due_announcements(), 1, 'the due announcement runs once');
select is(
  (select push_displayed from public.admin_announcement_deliveries where profile_id = 'c1650000-0000-4000-8000-000000000002'),
  false,
  'accepting a push is not the same as showing it'
);
select is(
  (select push_devices from public.admin_announcement_deliveries where profile_id = 'c1650000-0000-4000-8000-000000000002'),
  1,
  'an expired device is left out and the person is still one recipient'
);

select * from finish();
rollback;
