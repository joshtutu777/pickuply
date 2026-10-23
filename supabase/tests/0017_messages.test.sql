-- Local Supabase only. Phone numbers and emails are stored for admin review and hidden in the thread.

begin;

select plan(5);

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

select pg_temp.make_user('f1717171-1717-4171-8171-171717171711', 'message-customer@pickuply.test');

insert into public.message_threads (id, requester_id, kind)
values (
  'f1717171-1717-4171-8171-171717171721',
  'f1717171-1717-4171-8171-171717171711',
  'support'
);

select pg_temp.as_user('f1717171-1717-4171-8171-171717171711');
set local role authenticated;

select lives_ok(
  $$select public.post_message(
    'f1717171-1717-4171-8171-171717171721',
    'call me at 404-555-0100'
  )$$,
  'a phone number is stored and hidden from the thread'
);

select lives_ok(
  $$select public.post_message(
    'f1717171-1717-4171-8171-171717171721',
    'reach me at person@example.com'
  )$$,
  'an email address is stored and hidden from the thread'
);

select lives_ok(
  $$select public.post_message(
    'f1717171-1717-4171-8171-171717171721',
    'Please use the side door'
  )$$,
  'a message without contact details is saved'
);

select is(
  (select count(*) from public.messages
    where thread_id = 'f1717171-1717-4171-8171-171717171721'
      and body !~ '404-555-0100'
      and body !~ 'person@example.com')::integer,
  3,
  'others see the redacted text'
);

select throws_ok(
  $$insert into public.messages (thread_id, sender_id, body)
    values (
      'f1717171-1717-4171-8171-171717171721',
      'f1717171-1717-4171-8171-171717171711',
      'call me at 404-555-0100'
    )$$,
  '42501',
  'new row violates row-level security policy for table "messages"',
  'a participant cannot insert a message directly'
);

select * from finish();

rollback;
