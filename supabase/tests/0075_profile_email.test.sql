-- Profile email is optional, shared, and never cleared by a blank save.

begin;

select plan(8);

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
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    email, 'test-hash', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now(), uid::text, '', uid::text || '-email', uid::text || '-recovery'
  );
end;
$$;

select pg_temp.make_user('c1750000-0000-4000-8000-000000000001', 'ada@example.com');
select pg_temp.make_user('c1750000-0000-4000-8000-000000000002', 'blair@example.com');

create temporary table email_stamp as
select email_confirmed_at
from auth.users
where id = 'c1750000-0000-4000-8000-000000000001';

select pg_temp.as_user('c1750000-0000-4000-8000-000000000001');
select public.save_profile_email('  Ada.Updated@example.com  ');

select is(
  (select email from public.profiles where id = 'c1750000-0000-4000-8000-000000000001'),
  'Ada.Updated@example.com',
  'a signed-in person can save their own email'
);

select public.save_profile_email('   ');

select is(
  (select email from public.profiles where id = 'c1750000-0000-4000-8000-000000000001'),
  'Ada.Updated@example.com',
  'a blank email does not erase the saved address'
);

select throws_ok(
  $$ select public.save_profile_email('not-an-email') $$,
  'P0001',
  'email is not valid',
  'an invalid email is rejected'
);

select is(
  (select email from auth.users where id = 'c1750000-0000-4000-8000-000000000001'),
  'ada@example.com',
  'saving a profile email does not change the sign-in email'
);

select is(
  (select email_confirmed_at from auth.users where id = 'c1750000-0000-4000-8000-000000000001'),
  (select email_confirmed_at from email_stamp),
  'saving a profile email does not mark a new verification'
);

select pg_temp.as_user('c1750000-0000-4000-8000-000000000002');
select public.save_profile_email('blair.driver@example.com');

select is(
  (select email from public.profiles where id = 'c1750000-0000-4000-8000-000000000001'),
  'Ada.Updated@example.com',
  'one person cannot change another person''s email'
);

select is(
  (select count(*) from public.profiles where id = 'c1750000-0000-4000-8000-000000000002'),
  1::bigint,
  'a driver and customer share one profile row'
);

select is(
  (select email from public.profiles where id = 'c1750000-0000-4000-8000-000000000002'),
  'blair.driver@example.com',
  'the shared profile email is the address that was saved'
);

select * from finish();
rollback;
