-- Local only. Audit rows, last-admin deletion, and a customer write attempt.

begin;

select plan(7);

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

select pg_temp.make_user('c1620000-0000-4000-8000-000000000001', 'sec-customer@pickuply.test');
select pg_temp.make_user('c1620000-0000-4000-8000-000000000002', 'sec-admin@pickuply.test');
select pg_temp.make_user('c1620000-0000-4000-8000-000000000003', 'sec-admin2@pickuply.test');

update public.profiles set full_name = 'Sec Customer', phone = '5555550199' where id = 'c1620000-0000-4000-8000-000000000001';
update public.profiles set role = 'admin', full_name = 'Sec Admin' where id = 'c1620000-0000-4000-8000-000000000002';
update public.profiles set role = 'admin', full_name = 'Sec Admin Two' where id = 'c1620000-0000-4000-8000-000000000003';
update public.profiles set role = 'customer'
where role = 'admin'
  and id not in (
    'c1620000-0000-4000-8000-000000000002',
    'c1620000-0000-4000-8000-000000000003'
  );

select pg_temp.as_user('c1620000-0000-4000-8000-000000000002');
set local role authenticated;
select lives_ok(
  $$select public.suspend_account('c1620000-0000-4000-8000-000000000001', 'indefinite', 'first restriction', null, null)$$,
  'admin suspends a customer'
);
select lives_ok(
  $$select public.suspend_account('c1620000-0000-4000-8000-000000000001', 'temporary', 'longer restriction', now() + interval '5 days', null)$$,
  'the same restriction can be extended'
);
select results_eq(
  $$select count(*)::int from public.audit_log where target_id = 'c1620000-0000-4000-8000-000000000001' and action = 'extend_suspension'$$,
  $$values (1)$$,
  'an extension is audited'
);

reset role;
select pg_temp.as_user('c1620000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$update public.account_suspensions set reason = 'changed' where profile_id = auth.uid()$$,
  '42501',
  'permission denied for table account_suspensions',
  'a customer cannot edit a suspension'
);
select throws_ok(
  $$select public.complete_account_deletion('c1620000-0000-4000-8000-000000000002')$$,
  'only an admin can complete account deletion',
  'a customer cannot complete deletion'
);

reset role;
select pg_temp.as_user('c1620000-0000-4000-8000-000000000002');
set local role authenticated;
select lives_ok(
  $$select public.suspend_account('c1620000-0000-4000-8000-000000000003', 'indefinite', 'second admin', null, null)$$,
  'one of two admins can be suspended'
);
reset role;
select pg_temp.as_user('c1620000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$select public.complete_account_deletion('c1620000-0000-4000-8000-000000000002')$$,
  'the last active admin cannot be deleted',
  'the last active admin cannot be deleted'
);

select * from finish();
rollback;
