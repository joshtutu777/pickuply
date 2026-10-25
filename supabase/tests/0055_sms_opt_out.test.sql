begin;

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
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, phone, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'c1550000-0000-4000-8000-000000000055',
  'authenticated',
  'authenticated',
  'sms-opt@pickuply.test',
  '+15555550199',
  'test-hash',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  'c155',
  '',
  'c155-email',
  'c155-recovery'
);

select pg_temp.as_user('c1550000-0000-4000-8000-000000000055');
set local role authenticated;

select lives_ok(
  $$select public.record_sms_consent('login')$$,
  'consent is recorded'
);

select is(
  (select sms_enabled from public.notification_preferences where profile_id = 'c1550000-0000-4000-8000-000000000055'),
  true,
  'consent turns optional texts on'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select lives_ok(
  $$select public.record_sms_opt_out('+15555550199')$$,
  'STOP is recorded'
);

select is(
  (select sms_enabled from public.notification_preferences where profile_id = 'c1550000-0000-4000-8000-000000000055'),
  false,
  'STOP turns optional texts off'
);

select * from finish();
rollback;
