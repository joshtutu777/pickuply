-- Funnel events are insert-only for visitors and unreadable across accounts.

begin;

set local search_path to public, extensions;

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

select pg_temp.make_user('d3100000-0000-4000-8000-000000000001', 'funnel-one@pickuply.test');
select pg_temp.make_user('d3100000-0000-4000-8000-000000000002', 'funnel-two@pickuply.test');
update public.profiles set role = 'admin', full_name = 'Funnel Admin' where id = 'd3100000-0000-4000-8000-000000000002';

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'funnel_events'
      and column_name ~ '(^|_)(phone|email|address|photo|license)($|_)'
  ),
  'funnel events have no sensitive columns'
);

set local role anon;
select lives_ok(
  $$select public.record_funnel_event(
    'request_started', '1', 'delivery', 'quote', 'west_metro',
    'd3100000-0000-4000-8000-000000000099', 'nextdoor'
  )$$,
  'an anonymous visitor can record a session event'
);
select is(
  has_table_privilege('anon', 'public.funnel_events', 'select'),
  false,
  'an anonymous visitor cannot read funnel events'
);

reset role;
select pg_temp.as_user('d3100000-0000-4000-8000-000000000001');
select public.record_funnel_event(
  'request_submitted', 'submitted', 'delivery', 'quote', 'west_metro',
  'd3100000-0000-4000-8000-000000000001', null
);
select is(
  (select count(*)::int from public.funnel_events where user_id is distinct from auth.uid()),
  0,
  'a signed-in user cannot read someone else''s events'
);

select pg_temp.as_user('d3100000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.admin_funnel(current_date - 1, current_date, null)$$,
  'an admin can read the funnel'
);

reset role;
insert into public.funnel_events (event_name, step, session_id, created_at)
values ('request_started', '1', 'd3100000-0000-4000-8000-000000000088', now() - interval '91 days');
select public.delete_expired_funnel_events();
select is(
  (select count(*)::int from public.funnel_events where session_id = 'd3100000-0000-4000-8000-000000000088'),
  0,
  'events older than 90 days are removed'
);

select * from finish();
rollback;
