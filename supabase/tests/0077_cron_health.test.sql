-- The scheduler can record its latest result. A real admin can read it.

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

select pg_temp.make_user('c1770000-0000-4000-8000-000000000001', 'cron-customer@pickuply.test');
select pg_temp.make_user('c1770000-0000-4000-8000-000000000002', 'cron-real-admin@pickuply.test');
select pg_temp.make_user('c1770000-0000-4000-8000-000000000003', 'cron-test-admin@pickuply.test');
update public.profiles set role = 'admin', full_name = 'Cron Admin' where id = 'c1770000-0000-4000-8000-000000000002';
update public.profiles set role = 'admin', full_name = 'Cron Test Admin', is_test = true where id = 'c1770000-0000-4000-8000-000000000003';

select pg_temp.as_user('c1770000-0000-4000-8000-000000000001');
set local role authenticated;

select throws_ok(
  $$select public.record_cron_run('transfers', now(), now(), true, null)$$,
  '42501',
  'permission denied for function record_cron_run',
  'a customer cannot record a cron run'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select lives_ok(
  $$select public.record_cron_run('transfers', now() - interval '1 minute', now(), false, 'Bearer secret sk_test_abc whsec_def')$$,
  'the scheduler records a failed run'
);

reset role;

select ok(
  (select error_message from public.cron_job_runs where job_name = 'transfers') not like '%sk_test_%'
    and (select error_message from public.cron_job_runs where job_name = 'transfers') not like '%whsec_%'
    and (select error_message from public.cron_job_runs where job_name = 'transfers') like '%[redacted]%',
  'a stored cron error does not keep a token'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select lives_ok(
  $$select public.record_cron_run('transfers', now() - interval '1 minute', now(), true, 'old failure')$$,
  'a later success replaces the failed run'
);

reset role;

select is(
  (select ok and error_message is null from public.cron_job_runs where job_name = 'transfers'),
  true,
  'the latest run is the one the health page shows'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select throws_ok(
  $$select public.record_cron_run('not-a-job', now(), now(), true, null)$$,
  'P0001',
  'unknown scheduled job',
  'an unknown job name is rejected'
);

reset role;
select pg_temp.as_user('c1770000-0000-4000-8000-000000000002');
set local role authenticated;

select is(
  (select count(*)::int from public.cron_job_runs where job_name = 'transfers'),
  1,
  'a real admin can read the latest cron run'
);

reset role;
select pg_temp.as_user('c1770000-0000-4000-8000-000000000003');
set local role authenticated;

select is(
  (select count(*)::int from public.cron_job_runs),
  0,
  'a test admin cannot read scheduler status'
);

select * from finish();
rollback;
