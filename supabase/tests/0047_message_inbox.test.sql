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

select pg_temp.make_user('d4700000-0000-4000-8000-000000000001', 'inbox-driver@pickuply.test');
select pg_temp.make_user('d4700000-0000-4000-8000-000000000002', 'inbox-admin@pickuply.test');
select pg_temp.make_user('d4700000-0000-4000-8000-000000000003', 'inbox-customer@pickuply.test');
update public.profiles set role = 'admin', full_name = 'Inbox Admin' where id = 'd4700000-0000-4000-8000-000000000002';
update public.profiles set full_name = 'Inbox Driver' where id = 'd4700000-0000-4000-8000-000000000001';
insert into public.drivers (profile_id, status, home_city, home_zip)
values ('d4700000-0000-4000-8000-000000000001', 'pending_review', 'Austell', '30106');

select pg_temp.as_user('d4700000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.open_support_thread()$$,
  'use Help to contact Pickuply',
  'a customer cannot start an admin chat'
);

select pg_temp.as_user('d4700000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.request_driver_documents(
    'd4700000-0000-4000-8000-000000000001',
    array['insurance'],
    'Please add the insurance card.'
  )$$,
  'an admin can request a document in the support thread'
);

select pg_temp.as_user('d4700000-0000-4000-8000-000000000001');
select ok(
  (select unread > 0 from public.my_inbox() where kind = 'support'),
  'the document request is unread in the driver inbox'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select set_config('role', 'postgres', true);
select ok(
  (
    select href like '/driver/messages?thread=%&upload=insurance'
    from public.notifications
    where profile_id = 'd4700000-0000-4000-8000-000000000001'
      and kind = 'driver_documents'
  ),
  'the alert opens the support conversation'
);

select * from finish();
rollback;
