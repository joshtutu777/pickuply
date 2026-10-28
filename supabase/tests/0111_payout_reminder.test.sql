-- Local only. An approved driver gets one alert to add payout details.

begin;

select plan(7);

create or replace function pg_temp.as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'postgres', true);
end;
$$;

create or replace function pg_temp.as_user(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
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

select pg_temp.make_user('c1110000-0000-4000-8000-000000000001', 'payout-remind@pickuply.test');
select pg_temp.make_user('c1110000-0000-4000-8000-000000000002', 'payout-ready@pickuply.test');
update public.profiles set role = 'driver', full_name = 'Remind Driver' where id = 'c1110000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'Ready Driver' where id = 'c1110000-0000-4000-8000-000000000002';
insert into public.drivers (profile_id, status) values
  ('c1110000-0000-4000-8000-000000000001', 'pending_review'),
  ('c1110000-0000-4000-8000-000000000002', 'pending_review');

select is(
  (select count(*) from public.notifications where profile_id = 'c1110000-0000-4000-8000-000000000001' and kind = 'payout_setup'),
  0::bigint,
  'a driver in review is not reminded'
);

update public.drivers set status = 'active' where profile_id = 'c1110000-0000-4000-8000-000000000001';
select is(
  (select count(*) from public.notifications where profile_id = 'c1110000-0000-4000-8000-000000000001' and kind = 'payout_setup'),
  1::bigint,
  'approval creates one payout alert'
);
select is(
  (select title from public.notifications where profile_id = 'c1110000-0000-4000-8000-000000000001' and kind = 'payout_setup'),
  'Add your payout details',
  'the alert asks for payout details'
);

select pg_temp.as_user('c1110000-0000-4000-8000-000000000001');
select lives_ok(
  $$select public.remind_payout_setup()$$,
  'opening driver home does not add a second alert'
);
select pg_temp.as_postgres();
select is(
  (select count(*) from public.notifications where profile_id = 'c1110000-0000-4000-8000-000000000001' and kind = 'payout_setup'),
  1::bigint,
  'the payout alert stays one'
);

set local session_replication_role = replica;
update public.drivers set status = 'active' where profile_id = 'c1110000-0000-4000-8000-000000000002';
set local session_replication_role = origin;
insert into public.driver_connect_accounts (driver_id, stripe_account_id, payouts_enabled, details_submitted)
values ('c1110000-0000-4000-8000-000000000002', 'acct_testreminder2', true, true);
select pg_temp.as_user('c1110000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.remind_payout_setup()$$,
  'a finished payout setup is not reminded'
);
select pg_temp.as_postgres();
select is(
  (select count(*) from public.notifications where profile_id = 'c1110000-0000-4000-8000-000000000002' and kind = 'payout_setup'),
  0::bigint,
  'a finished payout setup creates no alert'
);

select * from finish();
rollback;
