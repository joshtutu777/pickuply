-- Local Supabase only. Optional SMS consent is a checked choice, not a phone number.

begin;

select plan(6);

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

select pg_temp.make_user('c1414141-1414-4141-8141-141414141414', 'sms-customer@pickuply.test');
select pg_temp.make_user('c1414141-1414-4141-8141-141414141415', 'sms-other@pickuply.test');

select pg_temp.as_user('c1414141-1414-4141-8141-141414141414');
set local role authenticated;

select lives_ok(
  $$select public.record_sms_consent('login')$$,
  'a signed-in person can record login consent'
);

select results_eq(
  $$select disclosure_version, source
    from public.sms_consents
    where profile_id = 'c1414141-1414-4141-8141-141414141414'$$,
  $$values ('2026-10-22'::text, 'login'::text)$$,
  'the row stores the disclosure version and the login source'
);

select throws_ok(
  $$select public.record_sms_consent('phone')$$,
  'consent source is not valid',
  'a phone number is not a consent source'
);

select throws_ok(
  $$insert into public.sms_consents (profile_id, disclosure_version, source)
    values ('c1414141-1414-4141-8141-141414141414', '2026-10-22', 'login')$$,
  '42501',
  'permission denied for table sms_consents',
  'direct insert is denied'
);

select pg_temp.as_user('c1414141-1414-4141-8141-141414141415');
set local role authenticated;

select is_empty(
  $$select id from public.sms_consents$$,
  'another person cannot read the consent'
);

set local role anon;

select throws_ok(
  $$select public.record_sms_consent('login')$$,
  '42501',
  'permission denied for function record_sms_consent',
  'an anonymous visitor cannot record consent'
);

select * from finish();
rollback;
