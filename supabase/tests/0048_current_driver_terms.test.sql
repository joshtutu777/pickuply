begin;

set local search_path to public, extensions;

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
    execute format(
      'grant execute on all functions in schema %I to anon, authenticated, service_role',
      sch
    );
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
  perform set_config('role', 'authenticated', true);
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

select pg_temp.make_user('d4800000-0000-4000-8000-000000000001', 'terms-driver@pickuply.test');
insert into public.drivers (
  profile_id, status, home_city, home_zip, license_url, license_expires, agreement_signed_at
) values (
  'd4800000-0000-4000-8000-000000000001',
  'active',
  'Austell',
  '30106',
  'd4800000-0000-4000-8000-000000000001/license.jpg',
  '2027-12-31',
  now()
);

select pg_temp.as_user('d4800000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.set_driver_online(true)$$,
  'Accept the Driver Terms to go Online.',
  'an older agreement does not unlock Online'
);

select is(
  (select terms_version from public.drivers where profile_id = 'd4800000-0000-4000-8000-000000000001'),
  null,
  'the terms stay unaccepted until the driver accepts them'
);

select lives_ok(
  $$select public.accept_driver_terms()$$,
  'the driver can accept the current terms'
);
select lives_ok(
  $$select public.set_driver_online(true)$$,
  'accepting the current terms unblocks Online'
);

select * from finish();
rollback;
