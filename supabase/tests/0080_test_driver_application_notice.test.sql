-- A test driver can submit an application while a real admin exists.

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

create or replace function pg_temp.clear_auth()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
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

select pg_temp.make_user('c1800000-0000-4000-8000-000000000001', 'apply-real-admin@pickuply.test');
select pg_temp.make_user('c1800000-0000-4000-8000-000000000002', 'apply-test-admin@pickuply.test');
select pg_temp.make_user('c1800000-0000-4000-8000-000000000003', 'apply-test-driver@pickuply.test');

select pg_temp.clear_auth();
update public.profiles set role = 'admin', full_name = 'Real Apply Admin' where id = 'c1800000-0000-4000-8000-000000000001';
update public.profiles set role = 'admin', full_name = 'Test Apply Admin', is_test = true where id = 'c1800000-0000-4000-8000-000000000002';
update public.profiles set full_name = 'Fresh Driver', is_test = true where id = 'c1800000-0000-4000-8000-000000000003';

select pg_temp.as_user('c1800000-0000-4000-8000-000000000003');
select lives_ok(
  $$insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online)
    values (
      'c1800000-0000-4000-8000-000000000003',
      'pending_review',
      (select id from public.zones where slug = 'west_metro'),
      'light',
      array['delivery']::public.job_service[],
      false
    )$$,
  'a test driver application is saved'
);

select is(
  (select count(*)::integer from public.notifications
    where dedupe_key = 'driver-application:c1800000-0000-4000-8000-000000000003'
      and profile_id = 'c1800000-0000-4000-8000-000000000001'),
  0,
  'a real admin is not notified'
);

select is(
  (select count(*)::integer from public.notifications
    where dedupe_key = 'driver-application:c1800000-0000-4000-8000-000000000003'
      and profile_id = 'c1800000-0000-4000-8000-000000000002'),
  1,
  'a test admin is notified'
);

select * from finish();
rollback;
