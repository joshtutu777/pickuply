-- Local only. An admin can delete an account and free the phone for a new sign-up.

begin;

select plan(12);

create or replace function pg_temp.as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'postgres', true);
end;
$$;

create or replace function pg_temp.as_user(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.make_user(uid uuid, email text, phone text)
returns void language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, phone, phone_confirmed_at, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    email, phone, now(), 'test-hash', now(), '{"provider":"phone","providers":["phone"]}'::jsonb,
    '{}'::jsonb, now(), now(), uid::text, '', uid::text || '-email', uid::text || '-recovery'
  );
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (
    uid, uid, jsonb_build_object('phone', phone), 'phone', phone, now(), now(), now()
  );
end;
$$;

select set_config('pickuply.phone_hmac_secret', 'local-test-secret', true);

select pg_temp.make_user('c1100000-0000-4000-8000-000000000001', 'release-clean@pickuply.test', '+15555550110');
select pg_temp.make_user('c1100000-0000-4000-8000-000000000002', 'release-busy@pickuply.test', '+15555550111');
select pg_temp.make_user('c1100000-0000-4000-8000-000000000003', 'release-admin@pickuply.test', '+15555550112');
select pg_temp.make_user('c1100000-0000-4000-8000-000000000004', 'release-admin2@pickuply.test', '+15555550113');
select pg_temp.make_user('c1100000-0000-4000-8000-000000000005', 'release-held@pickuply.test', '+15555550114');
select pg_temp.make_user('c1100000-0000-4000-8000-000000000006', 'release-driver@pickuply.test', '+15555550115');

update public.profiles set full_name = 'Clean Release', phone = '+15555550110' where id = 'c1100000-0000-4000-8000-000000000001';
update public.profiles set full_name = 'Busy Release', phone = '+15555550111' where id = 'c1100000-0000-4000-8000-000000000002';
update public.profiles set role = 'admin', full_name = 'Release Admin', phone = '+15555550112' where id = 'c1100000-0000-4000-8000-000000000003';
update public.profiles set role = 'admin', full_name = 'Release Admin Two', phone = '+15555550113' where id = 'c1100000-0000-4000-8000-000000000004';
update public.profiles set full_name = 'Held Release', phone = '+15555550114' where id = 'c1100000-0000-4000-8000-000000000005';
update public.profiles set role = 'driver', full_name = 'Release Driver', phone = '+15555550115' where id = 'c1100000-0000-4000-8000-000000000006';

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method
) values (
  'c1100000-0000-4000-8000-000000000010', 'c1100000-0000-4000-8000-000000000002', 'delivery', 'open',
  (select id from public.zones where slug = 'west_metro'), 'Austell 30106', 'Smyrna 30080', 'Busy request', 1, 'medium',
  0, 0, false, false, 'asap', 'fixed'
);

set local session_replication_role = replica;
update public.jobs
set status = 'assigned', assigned_driver_id = 'c1100000-0000-4000-8000-000000000006'
where id = 'c1100000-0000-4000-8000-000000000010';
set local session_replication_role = origin;

select pg_temp.as_user('c1100000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.admin_release_account('c1100000-0000-4000-8000-000000000002')$$,
  'only an admin can delete an account',
  'a customer cannot delete an account'
);

select pg_temp.as_user('c1100000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.admin_release_account('c1100000-0000-4000-8000-000000000002')$$,
  'this account still has obligations',
  'an open job blocks deletion'
);
select lives_ok(
  $$select public.suspend_account('c1100000-0000-4000-8000-000000000005', 'indefinite', 'held for review', null, null)$$,
  'an admin can suspend before deleting'
);
select lives_ok(
  $$select public.admin_release_account('c1100000-0000-4000-8000-000000000001')$$,
  'an admin can delete an account with no open job'
);
select lives_ok(
  $$select public.admin_release_account('c1100000-0000-4000-8000-000000000005')$$,
  'an admin can delete a suspended account'
);

select pg_temp.as_postgres();
select is(
  (select phone is null and deleted_at is not null and full_name = 'Deleted account' from public.profiles where id = 'c1100000-0000-4000-8000-000000000001'),
  true,
  'the old profile keeps no phone'
);
select is(
  (select phone is null from auth.users where id = 'c1100000-0000-4000-8000-000000000001'),
  true,
  'the old sign-in no longer holds the phone'
);
select is(
  (select count(*) from auth.identities where user_id = 'c1100000-0000-4000-8000-000000000001' and provider = 'phone'),
  0::bigint,
  'the phone sign-in identity is removed'
);
select is(
  (select count(*) from public.phone_restrictions where source_profile_id = 'c1100000-0000-4000-8000-000000000005'),
  0::bigint,
  'deleting the account does not ban the phone'
);

select pg_temp.make_user('c1100000-0000-4000-8000-000000000009', 'release-new@pickuply.test', '+15555550110');
select is(
  (
    select id = 'c1100000-0000-4000-8000-000000000009' and deleted_at is null
    from public.profiles
    where phone = '+15555550110'
  ),
  true,
  'the same phone can sign up as a new account'
);

select pg_temp.as_user('c1100000-0000-4000-8000-000000000003');
select lives_ok(
  $$select public.suspend_account('c1100000-0000-4000-8000-000000000004', 'indefinite', 'second admin', null, null)$$,
  'one of two admins can be suspended'
);
select pg_temp.as_user('c1100000-0000-4000-8000-000000000004');
select throws_ok(
  $$select public.admin_release_account('c1100000-0000-4000-8000-000000000003')$$,
  'the last active admin cannot be deleted',
  'the last active admin cannot be deleted'
);

select * from finish();
rollback;
