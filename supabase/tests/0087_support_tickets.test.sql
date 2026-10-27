-- Support tickets are private to the owner and admins.

begin;

select plan(5);

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

create or replace function pg_temp.as_user(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.make_user('c1870000-0000-4000-8000-000000000001', 'support-customer@pickuply.test');
select pg_temp.make_user('c1870000-0000-4000-8000-000000000002', 'support-other@pickuply.test');
select pg_temp.make_user('c1870000-0000-4000-8000-000000000003', 'support-admin@pickuply.test');
update public.profiles set role = 'admin' where id = 'c1870000-0000-4000-8000-000000000003';

select pg_temp.as_user('c1870000-0000-4000-8000-000000000001');
select public.create_support_ticket('Robin', '', 'robin@example.com', 'payments', 'The hold is still there.', '', null);
select ok(
  (select count(*) = 1 from public.notifications where title = 'New support request received.' and body = 'A new request is in the support inbox.' and profile_id = 'c1870000-0000-4000-8000-000000000003'),
  'an admin is notified without the message body'
);

select pg_temp.as_user('c1870000-0000-4000-8000-000000000003');
select public.admin_support_message(
  (select id from public.support_tickets where email = 'robin@example.com'),
  'Only admins see this.',
  true
);

set local role anon;
select is_empty($$select reference from public.support_tickets$$, 'anonymous visitors cannot read tickets');

reset role;
select pg_temp.as_user('c1870000-0000-4000-8000-000000000002');
set local role authenticated;
select is_empty($$select reference from public.support_tickets$$, 'another customer cannot read the ticket');
select is_empty(
  $$select body from public.support_ticket_messages$$,
  'another customer cannot read the conversation'
);

reset role;
select pg_temp.as_user('c1870000-0000-4000-8000-000000000001');
set local role authenticated;
select is_empty(
  $$select body from public.support_ticket_messages where kind = 'internal'$$,
  'the customer cannot read an internal note'
);

select * from finish();
rollback;
