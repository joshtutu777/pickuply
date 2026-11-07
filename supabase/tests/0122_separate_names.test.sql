-- Name backfill fills only a reliable split and never replaces a saved name.

begin;

select plan(12);

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

select pg_temp.make_user('c1220000-0000-4000-8000-000000000001', 'one@example.com');
select pg_temp.make_user('c1220000-0000-4000-8000-000000000002', 'two@example.com');
select pg_temp.make_user('c1220000-0000-4000-8000-000000000003', 'three@example.com');
select pg_temp.make_user('c1220000-0000-4000-8000-000000000004', 'kept@example.com');
select pg_temp.make_user('c1220000-0000-4000-8000-000000000005', 'bad@example.com');

update public.profiles
set full_name = 'Casey', first_name = null, last_name = null
where id = 'c1220000-0000-4000-8000-000000000001';
update public.profiles
set full_name = 'Ada Lovelace', first_name = null, last_name = null
where id = 'c1220000-0000-4000-8000-000000000002';
update public.profiles
set full_name = 'Mary Ann Smith', first_name = null, last_name = null
where id = 'c1220000-0000-4000-8000-000000000003';
update public.profiles
set full_name = 'Pat Lee', first_name = 'Patricia', last_name = null
where id = 'c1220000-0000-4000-8000-000000000004';
update public.profiles
set full_name = 'John3 Doe', first_name = null, last_name = null
where id = 'c1220000-0000-4000-8000-000000000005';

alter table public.profiles disable trigger profiles_guard_role;
select public.backfill_profile_names();
alter table public.profiles enable trigger profiles_guard_role;

select is(
  (select first_name || '|' || coalesce(last_name, '') || '|' || full_name from public.profiles where id = 'c1220000-0000-4000-8000-000000000001'),
  'Casey||Casey',
  'one saved word fills the first name and leaves the last name empty'
);

select is(
  (select first_name || '|' || last_name || '|' || full_name from public.profiles where id = 'c1220000-0000-4000-8000-000000000002'),
  'Ada|Lovelace|Ada Lovelace',
  'two saved words fill both names without changing the stored full name'
);

select is(
  (select first_name || '|' || coalesce(last_name, '') || '|' || full_name from public.profiles where id = 'c1220000-0000-4000-8000-000000000003'),
  'Mary||Mary Ann Smith',
  'three saved words do not invent a last name'
);

select is(
  (select first_name || '|' || coalesce(last_name, '') || '|' || full_name from public.profiles where id = 'c1220000-0000-4000-8000-000000000004'),
  'Patricia|Lee|Pat Lee',
  'an existing first name is kept and only the missing last name is filled'
);

select is(
  (select coalesce(first_name, '') || '|' || coalesce(last_name, '') || '|' || full_name from public.profiles where id = 'c1220000-0000-4000-8000-000000000005'),
  '||John3 Doe',
  'a name with a digit is left untouched'
);

select is(public.name_part_ok('José'), 'José', 'an accented name is reliable');
select is(public.name_part_ok('O’Brien'), 'O’Brien', 'a curly apostrophe is reliable');
select is(public.name_part_ok('.'), null, 'a period is not stored as a name');

select pg_temp.as_user('c1220000-0000-4000-8000-000000000001');
select public.save_profile_names('Casey', 'Customer');

select is(
  (select first_name || '|' || last_name || '|' || full_name from public.profiles where id = 'c1220000-0000-4000-8000-000000000001'),
  'Casey|Customer|Casey Customer',
  'saving both names stores them separately and updates the full name'
);

select throws_ok(
  $$ select public.save_profile_names('Casey', '   ') $$,
  'P0001',
  'enter your first and last name',
  'a blank last name does not clear the saved name'
);

select is(
  (select last_name from public.profiles where id = 'c1220000-0000-4000-8000-000000000001'),
  'Customer',
  'a rejected save leaves the last name in place'
);

select throws_ok(
  $$ select public.save_profile_names('Casey', '') $$,
  'P0001',
  'enter your first and last name',
  'an empty last name is rejected'
);

select * from finish();
rollback;
