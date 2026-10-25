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

select pg_temp.make_user('d4600000-0000-4000-8000-000000000001', 'anyway-driver@pickuply.test');
select pg_temp.make_user('d4600000-0000-4000-8000-000000000002', 'anyway-admin@pickuply.test');
update public.profiles set role = 'admin' where id = 'd4600000-0000-4000-8000-000000000002';
insert into public.drivers (
  profile_id, status, home_city, home_zip, license_url, license_expires, agreement_signed_at
) values (
  'd4600000-0000-4000-8000-000000000001',
  'pending_review',
  'Austell',
  '30106',
  'd4600000-0000-4000-8000-000000000001/license.jpg',
  '2027-12-31',
  now()
);

select pg_temp.as_user('d4600000-0000-4000-8000-000000000002');
select throws_ok(
  $$select public.review_driver(
    'd4600000-0000-4000-8000-000000000001',
    'approve_active',
    '',
    false
  )$$,
  'confirm approve anyway',
  'approval without insurance asks for confirmation'
);

select lives_ok(
  $$select public.review_driver(
    'd4600000-0000-4000-8000-000000000001',
    'approve_active',
    '',
    true
  )$$,
  'an admin can approve anyway when insurance is missing'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select set_config('role', 'postgres', true);
select is(
  (
    select data ->> 'approve_anyway'
    from public.audit_log
    where target_id = 'd4600000-0000-4000-8000-000000000001'
      and action = 'review_driver'
    order by created_at desc
    limit 1
  ),
  'true',
  'the audit log records the missing-document confirmation'
);

update public.drivers
set insurance_expires = '2020-01-01'
where profile_id = 'd4600000-0000-4000-8000-000000000001';
select pg_temp.as_user('d4600000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.set_driver_online(true)$$,
  'Your insurance expired on 1/1/2020 - upload a new card to go Online.',
  'an expired insurance date still blocks Online'
);

select * from finish();
rollback;
