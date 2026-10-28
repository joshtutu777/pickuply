-- Local only. SMS campaign audience, consent, and a send that does not text anyone.

begin;

select plan(37);

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

create or replace function pg_temp.verify_phone(uid uuid, phone text, confirmed boolean)
returns void language plpgsql as $$
begin
  update auth.users
  set phone = verify_phone.phone,
      phone_confirmed_at = case when confirmed then now() else null end
  where id = uid;
end;
$$;

select set_config('pickuply.phone_hmac_secret', 'local-test-secret', true);
select pg_temp.make_user('c1080000-0000-4000-8000-000000000001', 'sms-admin@pickuply.test');
select pg_temp.make_user('c1080000-0000-4000-8000-000000000002', 'sms-norcross@pickuply.test');
select pg_temp.make_user('c1080000-0000-4000-8000-000000000003', 'sms-duluth-driver@pickuply.test');
select pg_temp.make_user('c1080000-0000-4000-8000-000000000004', 'sms-sam@pickuply.test');
select pg_temp.make_user('c1080000-0000-4000-8000-000000000005', 'sms-unverified@pickuply.test');
select pg_temp.make_user('c1080000-0000-4000-8000-000000000006', 'sms-stopped@pickuply.test');
select pg_temp.make_user('c1080000-0000-4000-8000-000000000007', 'sms-transactional@pickuply.test');
select pg_temp.make_user('c1080000-0000-4000-8000-000000000008', 'sms-suspended@pickuply.test');
select pg_temp.make_user('c1080000-0000-4000-8000-000000000009', 'sms-test@pickuply.test');

update public.profiles set role = 'admin', full_name = 'Sky Admin' where id = 'c1080000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'Pat Driver' where id = 'c1080000-0000-4000-8000-000000000002';
update public.profiles set role = 'driver', full_name = 'Riley Driver' where id = 'c1080000-0000-4000-8000-000000000003';
update public.profiles set full_name = 'Sam Customer' where id = 'c1080000-0000-4000-8000-000000000004';
update public.profiles set full_name = 'Una Customer' where id = 'c1080000-0000-4000-8000-000000000005';
update public.profiles set full_name = 'Otto Customer' where id = 'c1080000-0000-4000-8000-000000000006';
update public.profiles set full_name = 'Tara Customer' where id = 'c1080000-0000-4000-8000-000000000007';
update public.profiles set full_name = 'Sue Customer' where id = 'c1080000-0000-4000-8000-000000000008';
update public.profiles set full_name = 'Tess Customer', is_test = true where id = 'c1080000-0000-4000-8000-000000000009';

select pg_temp.verify_phone('c1080000-0000-4000-8000-000000000002', '14045550102', true);
select pg_temp.verify_phone('c1080000-0000-4000-8000-000000000003', '14045550103', true);
select pg_temp.verify_phone('c1080000-0000-4000-8000-000000000004', '14045550104', true);
select pg_temp.verify_phone('c1080000-0000-4000-8000-000000000005', '14045550105', false);
select pg_temp.verify_phone('c1080000-0000-4000-8000-000000000006', '14045550106', true);
select pg_temp.verify_phone('c1080000-0000-4000-8000-000000000007', '14045550107', true);
select pg_temp.verify_phone('c1080000-0000-4000-8000-000000000008', '14045550108', true);
select pg_temp.verify_phone('c1080000-0000-4000-8000-000000000009', '14045550109', true);

insert into public.drivers (profile_id, status, home_city, home_zip, is_online)
values
  ('c1080000-0000-4000-8000-000000000002', 'active', 'Norcross', '30071', true),
  ('c1080000-0000-4000-8000-000000000003', 'active', 'Duluth', '30096', false);

insert into public.customer_places (customer_id, label, line1, city, zip)
values ('c1080000-0000-4000-8000-000000000004', 'Home', '1 Main Street', 'Duluth', '30096');

insert into public.notification_preferences (profile_id, sms_enabled, promotional_sms)
values
  ('c1080000-0000-4000-8000-000000000002', true, true),
  ('c1080000-0000-4000-8000-000000000003', true, true),
  ('c1080000-0000-4000-8000-000000000004', true, true),
  ('c1080000-0000-4000-8000-000000000005', true, true),
  ('c1080000-0000-4000-8000-000000000006', true, true),
  ('c1080000-0000-4000-8000-000000000007', true, false),
  ('c1080000-0000-4000-8000-000000000008', true, true),
  ('c1080000-0000-4000-8000-000000000009', true, true);

insert into public.sms_consents (profile_id, disclosure_version, source, opted_out_at)
values ('c1080000-0000-4000-8000-000000000006', '2026-10-23', 'login', now());

insert into public.account_suspensions (profile_id, status, kind, reason, created_by)
values (
  'c1080000-0000-4000-8000-000000000008', 'active', 'indefinite', 'test hold',
  'c1080000-0000-4000-8000-000000000001'
);

select pg_temp.as_user('c1080000-0000-4000-8000-000000000001');
set local role authenticated;

select is(
  (public.sms_campaign_preview('{"kind":"customers"}'::jsonb, 'promotional') ->> 'phones')::integer,
  1,
  'marketing texts count one verified customer who opted in'
);
select is(
  (public.sms_campaign_preview('{"kind":"customers"}'::jsonb, 'promotional') ->> 'optedOut')::integer,
  1,
  'STOP removes a number from the marketing count'
);
select is(
  (public.sms_campaign_preview('{"kind":"customers"}'::jsonb, 'promotional') ->> 'noMarketingConsent')::integer,
  1,
  'a person without the marketing checkbox is not in a marketing count'
);
select is(
  (public.sms_campaign_preview('{"kind":"customers"}'::jsonb, 'account_support') ->> 'phones')::integer,
  1,
  'account support still requires marketing consent and still honors STOP'
);
select is(
  (public.sms_campaign_preview('{"kind":"both","zips":["30071"]}'::jsonb, 'promotional') ->> 'phones')::integer,
  1,
  'a ZIP filter keeps the Norcross driver'
);
select is(
  (public.sms_campaign_preview('{"kind":"both","cities":["Duluth"],"zips":["30071"]}'::jsonb, 'promotional') ->> 'phones')::integer,
  0,
  'a city and a ZIP must both match'
);
select is(
  (public.sms_campaign_preview('{"kind":"both","cities":["Duluth"],"zips":["30096"],"states":["GA"]}'::jsonb, 'promotional') ->> 'phones')::integer,
  2,
  'Duluth and 30096 together include the driver and the customer'
);
select is(
  (public.sms_campaign_preview('{"kind":"both","states":["AL"]}'::jsonb, 'promotional') ->> 'phones')::integer,
  0,
  'a state outside Georgia matches nobody'
);
select is(
  (public.sms_campaign_preview('{"kind":"drivers"}'::jsonb, 'promotional') ->> 'phones')::integer,
  2,
  'eligible drivers are Pat and Riley'
);
select is(
  (public.sms_campaign_preview('{"kind":"both"}'::jsonb, 'promotional') ->> 'phones')::integer,
  3,
  'both includes the opted-in customer and the two drivers'
);
select is(
  (public.sms_campaign_preview('{"kind":"selected","ids":["c1080000-0000-4000-8000-000000000002","c1080000-0000-4000-8000-000000000004"]}'::jsonb, 'promotional') ->> 'phones')::integer,
  2,
  'a selected group keeps those two people'
);
select is(
  (public.sms_campaign_preview('{"kind":"individual","ids":["c1080000-0000-4000-8000-000000000007"]}'::jsonb, 'account_support') ->> 'phones')::integer,
  0,
  'labeling a text account support does not skip the marketing checkbox'
);
select is(
  (public.sms_campaign_preview('{"kind":"both","zips":["30071","30096"]}'::jsonb, 'promotional') ->> 'phones')::integer,
  3,
  'several ZIP codes match any one of them'
);
select is(
  (public.sms_campaign_preview('{"kind":"both","cities":["Norcross","Duluth"]}'::jsonb, 'promotional') ->> 'phones')::integer,
  3,
  'several cities match any one of them'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select pg_temp.make_user('c1080000-0000-4000-8000-000000000010', 'sms-cover@pickuply.test');
update public.profiles set role = 'driver', full_name = 'Casey Driver' where id = 'c1080000-0000-4000-8000-000000000010';
select pg_temp.verify_phone('c1080000-0000-4000-8000-000000000010', '14045550110', true);
insert into public.drivers (profile_id, status, home_city, home_zip, is_online)
values ('c1080000-0000-4000-8000-000000000010', 'active', 'Atlanta', '30301', true);
insert into public.notification_preferences (profile_id, sms_enabled, promotional_sms)
values ('c1080000-0000-4000-8000-000000000010', true, true);
insert into public.driver_feed_filters (profile_id, cities, zips)
values ('c1080000-0000-4000-8000-000000000010', '{}', '{30071}');
select pg_temp.as_user('c1080000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (public.sms_campaign_preview('{"kind":"drivers","zips":["30071"]}'::jsonb, 'promotional') ->> 'phones')::integer,
  2,
  'Areas I Cover matches a ZIP the home address does not'
);
select is(
  (public.sms_campaign_preview('{"kind":"drivers","cities":["Atlanta"]}'::jsonb, 'promotional') ->> 'phones')::integer,
  1,
  'a home city matches on its own'
);
select is(
  (public.sms_campaign_preview('{"kind":"drivers","cities":["Norcross"]}'::jsonb, 'promotional') ->> 'phones')::integer,
  1,
  'a covered ZIP is not treated as a covered city'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select pg_temp.make_user('c1080000-0000-4000-8000-000000000011', 'sms-duplicate@pickuply.test');
update public.profiles set full_name = 'Sam Copy' where id = 'c1080000-0000-4000-8000-000000000011';
select pg_temp.verify_phone('c1080000-0000-4000-8000-000000000011', '4045550104', true);
insert into public.notification_preferences (profile_id, sms_enabled, promotional_sms)
values ('c1080000-0000-4000-8000-000000000011', true, true);
insert into public.customer_places (customer_id, label, line1, city, zip)
values ('c1080000-0000-4000-8000-000000000011', 'Home', '2 Main Street', 'Duluth', '30096');
select pg_temp.as_user('c1080000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (public.sms_campaign_preview('{"kind":"customers","cities":["Duluth"]}'::jsonb, 'promotional') ->> 'phones')::integer,
  1,
  'two profiles with one phone count once'
);
select is(
  (public.sms_campaign_preview('{"kind":"customers","cities":["Duluth"]}'::jsonb, 'promotional') ->> 'duplicatesRemoved')::integer,
  1,
  'the extra profile is the duplicate that was removed'
);

select lives_ok(
  $$select public.save_sms_campaign(
    null, 'Saturday', 'Hi {{first_name}}.',
    '{"kind":"individual","ids":["c1080000-0000-4000-8000-000000000004"]}'::jsonb,
    'promotional'
  )$$,
  'an admin can save a draft'
);
select public.schedule_sms_campaign(
  (select id from public.sms_campaigns where name = 'Saturday'),
  now()
);
select public.pause_sms_campaign((select id from public.sms_campaigns where name = 'Saturday'));
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select is(public.execute_due_sms_campaigns(), 0, 'a paused campaign does not run');

select pg_temp.as_user('c1080000-0000-4000-8000-000000000001');
set local role authenticated;
select public.schedule_sms_campaign((select id from public.sms_campaigns where name = 'Saturday'), now());
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select is(public.execute_due_sms_campaigns(), 1, 'the scheduler records one due campaign');
select is(
  (select status || '|' || coalesce(reason, '') || '|' || body
    from public.sms_campaign_deliveries
    where profile_id = 'c1080000-0000-4000-8000-000000000004'),
  'skipped|texting_off|Pickuply: Hi Sam. Reply STOP to opt out.',
  'texting stays off, the first name is filled in, and STOP is included'
);
select is(public.execute_due_sms_campaigns(), 0, 'running the scheduler again does not record a second delivery');
select is(
  (select count(*) from public.sms_campaign_deliveries
    where profile_id = 'c1080000-0000-4000-8000-000000000004')::integer,
  1,
  'Sam still has one delivery row'
);
select is(
  (select count(*) from public.sms_campaign_deliveries where status = 'sent')::integer,
  0,
  'texting off never stores a sent delivery'
);

select pg_temp.as_user('c1080000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.sms_campaign_preview('{"kind":"customers"}'::jsonb, 'promotional')$$,
  'only an admin can preview a text campaign',
  'a customer cannot preview a campaign'
);
select throws_ok(
  $$select public.save_sms_campaign(null, 'Nope', 'Hi', '{"kind":"customers"}'::jsonb, 'promotional')$$,
  'only an admin can save a text campaign',
  'a customer cannot save a campaign'
);

select pg_temp.as_user('c1080000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.sms_campaign_preview('{"kind":"customers","zips":["12"]}'::jsonb, 'promotional')$$,
  'Use 5-digit ZIP codes.',
  'a bad ZIP is rejected'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$select public.sms_campaign_enforce_limits('c1080000-0000-4000-8000-000000000001', 'bulk', 1001)$$,
  'This audience is over 1,000 people. Narrow it before sending. Nobody was left off silently.',
  'more than 1,000 people is refused'
);

select pg_temp.as_user('c1080000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_sms_campaign(
  null, 'Cancel me', 'Hi {{first_name}}.',
  '{"kind":"individual","ids":["c1080000-0000-4000-8000-000000000002"]}'::jsonb,
  'promotional'
);
select public.schedule_sms_campaign((select id from public.sms_campaigns where name = 'Cancel me'), now());
select public.cancel_sms_campaign((select id from public.sms_campaigns where name = 'Cancel me'));
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select is(public.execute_due_sms_campaigns(), 0, 'a cancelled campaign does not run');
select is(
  (select count(*) from public.sms_campaign_deliveries deliveries
    join public.sms_campaigns campaigns on campaigns.id = deliveries.campaign_id
    where campaigns.name = 'Cancel me')::integer,
  0,
  'a cancelled campaign has no delivery rows'
);

select pg_temp.as_user('c1080000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_sms_campaign(
  null, 'Stop later', 'Hi {{first_name}}.',
  '{"kind":"individual","ids":["c1080000-0000-4000-8000-000000000003"]}'::jsonb,
  'account_support'
);
select public.schedule_sms_campaign((select id from public.sms_campaigns where name = 'Stop later'), now());
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
insert into public.sms_consents (profile_id, disclosure_version, source, opted_out_at)
values ('c1080000-0000-4000-8000-000000000003', '2026-10-23', 'login', now());
select public.execute_due_sms_campaigns();
select is(
  (select count(*) from public.sms_campaign_deliveries
    where profile_id = 'c1080000-0000-4000-8000-000000000003'
      and status in ('mocked', 'sent'))::integer,
  0,
  'STOP after scheduling blocks the send'
);

select is(
  (public.announcement_sms_state(
    'c1080000-0000-4000-8000-000000000002',
    'promotional',
    '2026-01-15 04:00:00-05'
  )).state,
  'skipped',
  'quiet hours are not reached while texting is off'
);
update public.platform_settings set sms_enabled = true where id = 1;
select is(
  (public.announcement_sms_state(
    'c1080000-0000-4000-8000-000000000002',
    'promotional',
    '2026-01-15 04:00:00-05'
  )).state,
  'deferred',
  'a night send waits until morning and is not delivered'
);
select is(
  (public.announcement_sms_state(
    'c1080000-0000-4000-8000-000000000007',
    'promotional',
    '2026-01-15 12:00:00-05'
  )).state,
  'skipped',
  'a person without marketing consent is not simulated'
);
select is(
  (public.announcement_sms_state(
    'c1080000-0000-4000-8000-000000000002',
    'promotional',
    '2026-01-15 12:00:00-05'
  )).state,
  'mocked',
  'daytime with texting on is simulated inside the test and is not a sent text'
);

select * from finish();
rollback;
