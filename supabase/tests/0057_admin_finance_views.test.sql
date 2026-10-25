-- Local only. A saved finance view is visible to that admin alone.

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
    execute format('grant execute on all functions in schema %I to anon, authenticated, service_role', sch);
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

select pg_temp.make_user('c1570000-0000-4000-8000-000000000001', 'finance-admin@pickuply.test');
select pg_temp.make_user('c1570000-0000-4000-8000-000000000002', 'finance-customer@pickuply.test');

update public.profiles set role = 'admin' where id = 'c1570000-0000-4000-8000-000000000001';

select pg_temp.as_user('c1570000-0000-4000-8000-000000000002');
set local role authenticated;

select throws_ok(
  $$insert into public.admin_finance_views (admin_id, query) values ('c1570000-0000-4000-8000-000000000002', 'tab=overview')$$,
  '42501',
  'new row violates row-level security policy for table "admin_finance_views"',
  'a customer cannot save a finance view'
);

reset role;
select pg_temp.as_user('c1570000-0000-4000-8000-000000000001');
set local role authenticated;

select lives_ok(
  $$insert into public.admin_finance_views (admin_id, query) values ('c1570000-0000-4000-8000-000000000001', 'tab=payments')$$,
  'an admin can save their own finance view'
);

select results_eq(
  $$select query from public.admin_finance_views$$,
  $$values ('tab=payments')$$,
  'an admin can read their saved view'
);

reset role;
select pg_temp.as_user('c1570000-0000-4000-8000-000000000002');
set local role authenticated;

select is_empty(
  $$select query from public.admin_finance_views$$,
  'another person cannot read the saved view'
);

select * from finish();
rollback;
