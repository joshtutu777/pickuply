-- Local Supabase only. Do not run this against the hosted project.

begin;

select plan(19);

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

create or replace function pg_temp.clear_auth()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
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

create or replace function pg_temp.payload(person_name text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'service', 'delivery',
    'description', 'Oak dresser',
    'pieces', 1,
    'size', 'medium',
    'item_value_cents', 8000,
    'listing_url', null,
    'stairs_pickup', 0,
    'elevator', false,
    'help_loading', true,
    'preferred_date', 'asap',
    'time_window', null,
    'notes', null,
    'pricing_method', 'quote',
    'offer_cents', null,
    'budget_min_cents', null,
    'budget_max_cents', null,
    'source', 'nextdoor',
    'zone_slug', 'west_metro',
    'pickup_area', 'Austell, 30106',
    'dropoff_area', 'Smyrna, 30080',
    'pickup_address', '10 Secret Street',
    'dropoff_address', '20 Hidden Avenue',
    'stairs_dropoff', 0,
    'already_paid', true,
    'seller_holding', false,
    'wants_item_check', true,
    'junk_load_size', null,
    'junk_materials', null,
    'junk_special_items', null,
    'store_name', null,
    'store_order_number', null,
    'customer_name', person_name,
    'customer_phone', '+14045551212',
    'customer_email', null,
    'access_notes', null
  );
$$;

create or replace function pg_temp.clear_name(uid uuid)
returns void language plpgsql as $$
begin
  alter table public.profiles disable trigger profiles_stamp_registration;
  alter table public.profiles disable trigger profiles_guard_role;
  update public.profiles
  set first_name = null, last_name = null, full_name = null, registration_completed_at = null
  where id = uid;
  alter table public.profiles enable trigger profiles_stamp_registration;
  alter table public.profiles enable trigger profiles_guard_role;
end;
$$;

select pg_temp.make_user('c1280000-0000-4000-8000-000000000001', 'otp@example.com');
select pg_temp.make_user('c1280000-0000-4000-8000-000000000002', 'named@example.com');
select pg_temp.make_user('c1280000-0000-4000-8000-000000000003', 'request@example.com');
select pg_temp.make_user('c1280000-0000-4000-8000-000000000004', 'kept@example.com');
select pg_temp.make_user('c1280000-0000-4000-8000-000000000005', 'one@example.com');
select pg_temp.make_user('c1280000-0000-4000-8000-000000000006', 'three@example.com');
select pg_temp.make_user('c1280000-0000-4000-8000-000000000007', 'bad@example.com');
select pg_temp.make_user('c1280000-0000-4000-8000-000000000008', 'old@example.com');
select pg_temp.make_user('c1280000-0000-4000-8000-000000000009', 'split@example.com');
select pg_temp.make_user('c1280000-0000-4000-8000-000000000010', 'partial@example.com');

select ok(
  position(
    'perform public.apply_missing_profile_name(customer_name_value);'
    in pg_get_functiondef('public.create_customer_request(uuid, jsonb)'::regprocedure)
  ) > 0,
  'a request saves a missing profile name in the same transaction'
);

select is(
  (select coalesce(first_name, '') || '|' || coalesce(last_name, '') || '|' || coalesce(full_name, '') || '|' || coalesce(registration_completed_at::text, '')
   from public.profiles where id = 'c1280000-0000-4000-8000-000000000001'),
  '|||',
  'phone verification alone leaves the name empty and registration unfinished'
);

set local role authenticated;
select pg_temp.as_user('c1280000-0000-4000-8000-000000000002');
select public.save_profile_names('Casey', 'Customer');
reset role;
select pg_temp.clear_auth();

alter table public.profiles disable trigger profiles_stamp_registration;
alter table public.profiles disable trigger profiles_guard_role;
update public.profiles
set registration_completed_at = '2020-01-01 00:00:00+00'
where id = 'c1280000-0000-4000-8000-000000000002';
alter table public.profiles enable trigger profiles_stamp_registration;
alter table public.profiles enable trigger profiles_guard_role;

set local role authenticated;
select pg_temp.as_user('c1280000-0000-4000-8000-000000000002');
select public.save_profile_names('Casey', 'Lee');
reset role;
select pg_temp.clear_auth();

select is(
  (select first_name || '|' || last_name from public.profiles where id = 'c1280000-0000-4000-8000-000000000002'),
  'Casey|Lee',
  'returning to the name page saves both names'
);
select is(
  (select registration_completed_at from public.profiles where id = 'c1280000-0000-4000-8000-000000000002'),
  '2020-01-01 00:00:00+00'::timestamptz,
  'finishing registration keeps the original completion time'
);

set local role authenticated;
select pg_temp.as_user('c1280000-0000-4000-8000-000000000003');
select public.create_customer_request('c1280000-0000-4000-8000-000000000103'::uuid, pg_temp.payload('Ada Lovelace'));
select pg_temp.as_user('c1280000-0000-4000-8000-000000000004');
select public.save_profile_names('Patricia', 'Lee');
reset role;
select pg_temp.clear_auth();

create temp table kept_completion as
select registration_completed_at as completed
from public.profiles
where id = 'c1280000-0000-4000-8000-000000000004';

set local role authenticated;
select pg_temp.as_user('c1280000-0000-4000-8000-000000000004');
select public.create_customer_request('c1280000-0000-4000-8000-000000000104'::uuid, pg_temp.payload('Other Person'));
select pg_temp.as_user('c1280000-0000-4000-8000-000000000005');
select public.create_customer_request('c1280000-0000-4000-8000-000000000105'::uuid, pg_temp.payload('Casey'));
select pg_temp.as_user('c1280000-0000-4000-8000-000000000006');
select public.create_customer_request('c1280000-0000-4000-8000-000000000106'::uuid, pg_temp.payload('Mary Ann Smith'));
select pg_temp.as_user('c1280000-0000-4000-8000-000000000007');
select throws_ok(
  $$ select public.create_customer_request('c1280000-0000-4000-8000-000000000107'::uuid, pg_temp.payload('John3')) $$,
  'P0001',
  'enter your name using letters, spaces, apostrophes, periods, or hyphens',
  'a name that cannot be stored does not save the request'
);
select pg_temp.as_user('c1280000-0000-4000-8000-000000000008');
select public.create_customer_request('c1280000-0000-4000-8000-000000000108'::uuid, pg_temp.payload('Ada Lovelace'));
select pg_temp.as_user('c1280000-0000-4000-8000-000000000009');
select public.create_customer_request('c1280000-0000-4000-8000-000000000109'::uuid, pg_temp.payload('Ada Lovelace'));
reset role;
select pg_temp.clear_auth();
select pg_temp.clear_name('c1280000-0000-4000-8000-000000000009');

set local role authenticated;
select pg_temp.as_user('c1280000-0000-4000-8000-000000000009');
select public.create_customer_request('c1280000-0000-4000-8000-000000000119'::uuid, pg_temp.payload('Casey Customer'));
reset role;
select pg_temp.clear_auth();
select pg_temp.clear_name('c1280000-0000-4000-8000-000000000008');
select pg_temp.clear_name('c1280000-0000-4000-8000-000000000009');

alter table public.profiles disable trigger profiles_stamp_registration;
alter table public.profiles disable trigger profiles_guard_role;
update public.profiles
set first_name = 'Casey', last_name = null, full_name = 'Casey', registration_completed_at = null
where id = 'c1280000-0000-4000-8000-000000000010';
alter table public.profiles enable trigger profiles_stamp_registration;
alter table public.profiles enable trigger profiles_guard_role;

set local role authenticated;
select pg_temp.as_user('c1280000-0000-4000-8000-000000000010');
select public.create_customer_request('c1280000-0000-4000-8000-000000000110'::uuid, pg_temp.payload('Ada Lovelace'));
reset role;
select pg_temp.clear_auth();

select is(
  (select first_name || '|' || last_name || '|' || full_name || '|' || (registration_completed_at is not null)
   from public.profiles where id = 'c1280000-0000-4000-8000-000000000003'),
  'Ada|Lovelace|Ada Lovelace|true',
  'a two-word request name completes registration'
);
select is(
  (select count(*) from public.jobs where id = 'c1280000-0000-4000-8000-000000000103'),
  1::bigint,
  'the two-word request is saved'
);
select is(
  (select first_name || '|' || last_name || '|' || full_name from public.profiles where id = 'c1280000-0000-4000-8000-000000000004'),
  'Patricia|Lee|Patricia Lee',
  'a request does not replace a finished name'
);
select is(
  (select registration_completed_at = (select completed from kept_completion) from public.profiles where id = 'c1280000-0000-4000-8000-000000000004'),
  true,
  'a later request does not move the completion time'
);
select is(
  (select first_name || '|' || coalesce(last_name, '') || '|' || full_name || '|' || coalesce(registration_completed_at::text, '')
   from public.profiles where id = 'c1280000-0000-4000-8000-000000000005'),
  'Casey||Casey|',
  'one request name does not invent a last name'
);
select is(
  (select count(*) from public.jobs where id = 'c1280000-0000-4000-8000-000000000105'),
  1::bigint,
  'a one-word request is still saved'
);
select is(
  (select first_name || '|' || coalesce(last_name, '') || '|' || full_name || '|' || coalesce(registration_completed_at::text, '')
   from public.profiles where id = 'c1280000-0000-4000-8000-000000000006'),
  'Mary||Mary Ann Smith|',
  'three request names do not invent a last name'
);
select is(
  (select count(*) from public.jobs where id = 'c1280000-0000-4000-8000-000000000107'),
  0::bigint,
  'the rejected name left no request behind'
);

select cmp_ok(
  public.backfill_missing_profile_names_from_requests(),
  '>=',
  1,
  'an empty profile with one reliable request name is filled'
);
select is(
  (select first_name || '|' || last_name || '|' || full_name || '|' || (registration_completed_at is not null)
   from public.profiles where id = 'c1280000-0000-4000-8000-000000000008'),
  'Ada|Lovelace|Ada Lovelace|true',
  'an old unnamed customer with one request name is filled'
);
select is(
  (select coalesce(first_name, '') || '|' || coalesce(last_name, '') || '|' || coalesce(full_name, '')
   from public.profiles where id = 'c1280000-0000-4000-8000-000000000009'),
  '||',
  'conflicting request names are not guessed'
);
select is(
  (select first_name || '|' || coalesce(last_name, '') || '|' || full_name
   from public.profiles where id = 'c1280000-0000-4000-8000-000000000010'),
  'Casey||Casey',
  'a saved first name is not replaced by a different request name'
);

select is(
  (select coalesce(first_name, '') || '|' || coalesce(last_name, '') || '|' || coalesce(full_name, '')
   from public.profiles where id = 'c1280000-0000-4000-8000-000000000001'),
  '||',
  'a phone-only customer with no request stays unnamed'
);
select is(
  (select coalesce(first_name, '') || '|' || coalesce(last_name, '') || '|' || coalesce(full_name, '')
   from public.profiles where id = 'c1280000-0000-4000-8000-000000000007'),
  '||',
  'a rejected request leaves the profile unnamed'
);

select * from finish();
rollback;
