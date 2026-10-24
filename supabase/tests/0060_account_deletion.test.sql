-- Local only. Deletion, phone restriction, expiry, and neutral offer errors.

begin;

select plan(22);

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

select set_config('pickuply.phone_hmac_secret', 'local-test-secret', true);

select pg_temp.make_user('c1610000-0000-4000-8000-000000000001', 'del-clean@pickuply.test');
select pg_temp.make_user('c1610000-0000-4000-8000-000000000002', 'del-busy@pickuply.test');
select pg_temp.make_user('c1610000-0000-4000-8000-000000000003', 'del-driver@pickuply.test');
select pg_temp.make_user('c1610000-0000-4000-8000-000000000004', 'del-admin@pickuply.test');
select pg_temp.make_user('c1610000-0000-4000-8000-000000000005', 'del-admin2@pickuply.test');
select pg_temp.make_user('c1610000-0000-4000-8000-000000000006', 'del-expire@pickuply.test');
select pg_temp.make_user('c1610000-0000-4000-8000-000000000007', 'del-stale@pickuply.test');
select pg_temp.make_user('c1610000-0000-4000-8000-000000000008', 'del-held@pickuply.test');

update public.profiles set full_name = 'Clean', phone = '5555550193' where id = 'c1610000-0000-4000-8000-000000000001';
update public.profiles set full_name = 'Busy', phone = '5555550194' where id = 'c1610000-0000-4000-8000-000000000002';
update public.profiles set role = 'driver', full_name = 'Del Driver', phone = '5555550195' where id = 'c1610000-0000-4000-8000-000000000003';
update public.profiles set role = 'admin', full_name = 'Del Admin' where id = 'c1610000-0000-4000-8000-000000000004';
update public.profiles set role = 'admin', full_name = 'Del Admin Two' where id = 'c1610000-0000-4000-8000-000000000005';
update public.profiles set full_name = 'Expire', phone = '5555550196' where id = 'c1610000-0000-4000-8000-000000000006';
update public.profiles set full_name = 'Stale', phone = '5555550197' where id = 'c1610000-0000-4000-8000-000000000007';
update public.profiles set full_name = 'Held', phone = '5555550198' where id = 'c1610000-0000-4000-8000-000000000008';
update auth.users set last_sign_in_at = now() - interval '2 hours' where id = 'c1610000-0000-4000-8000-000000000007';

insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online)
values (
  'c1610000-0000-4000-8000-000000000003', 'active',
  (select id from public.zones where slug = 'west_metro'),
  'full', array['delivery']::public.job_service[], true
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values (
  'c1610000-0000-4000-8000-000000000011', 'c1610000-0000-4000-8000-000000000002',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'booked request', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000
), (
  'c1610000-0000-4000-8000-000000000012', 'c1610000-0000-4000-8000-000000000006',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'expiring request', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000
), (
  'c1610000-0000-4000-8000-000000000013', 'c1610000-0000-4000-8000-000000000008',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'held request', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000
);

update public.jobs
set status = 'assigned', assigned_driver_id = 'c1610000-0000-4000-8000-000000000003', payment_status = 'authorized'
where id = 'c1610000-0000-4000-8000-000000000011';

insert into public.job_offers (
  job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents,
  customer_total_cents, status, expires_at
) values (
  'c1610000-0000-4000-8000-000000000013', 'c1610000-0000-4000-8000-000000000003',
  'accept', 5000, 0, 0, 5000, 'active', now() + interval '1 day'
);

select pg_temp.as_user('c1610000-0000-4000-8000-000000000001');
set local role authenticated;
select results_eq(
  $$select public.request_account_deletion()$$,
  $$values ('completed')$$,
  'a customer with no obligations is deleted'
);
reset role;
select is(
  (select phone is null and deleted_at is not null from public.profiles where id = 'c1610000-0000-4000-8000-000000000001'),
  true,
  'the deleted profile no longer has a phone'
);
select is_empty(
  $$select phone_hmac from public.phone_restrictions$$,
  'a normal deletion does not block the phone'
);

select pg_temp.as_user('c1610000-0000-4000-8000-000000000002');
set local role authenticated;
select results_eq(
  $$select public.request_account_deletion()$$,
  $$values ('pending')$$,
  'an active booking keeps deletion pending'
);
select results_eq(
  $$select public.request_account_deletion()$$,
  $$values ('pending')$$,
  'a second deletion request does not create another row'
);
reset role;
select results_eq(
  $$select count(*)::int from public.account_deletion_requests where profile_id = 'c1610000-0000-4000-8000-000000000002'$$,
  $$values (1)$$,
  'only one open deletion request exists'
);
select is(
  (select phone from public.profiles where id = 'c1610000-0000-4000-8000-000000000002'),
  '5555550194',
  'a pending deletion keeps the phone'
);

select pg_temp.as_user('c1610000-0000-4000-8000-000000000007');
set local role authenticated;
select throws_ok(
  $$select public.request_account_deletion()$$,
  'confirm your phone again',
  'an old sign-in cannot delete an account'
);

reset role;
select pg_temp.as_user('c1610000-0000-4000-8000-000000000004');
set local role authenticated;
select lives_ok(
  $$select public.suspend_account('c1610000-0000-4000-8000-000000000003', 'indefinite', 'offer closed', null, null)$$,
  'admin suspends the driver'
);

reset role;
select pg_temp.as_user('c1610000-0000-4000-8000-000000000008');
set local role authenticated;
select throws_ok(
  $$select public.choose_offer((select id from public.job_offers where job_id = 'c1610000-0000-4000-8000-000000000013'))$$,
  'that offer is no longer available',
  'a closed offer cannot be booked'
);

reset role;
select pg_temp.as_user('c1610000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$select public.assert_driver_can_take_job('c1610000-0000-4000-8000-000000000012', 'offer')$$,
  'Your Pickuply driver account is restricted. You cannot submit offers or accept new jobs while this restriction is active.',
  'a suspended driver cannot offer'
);

reset role;
select pg_temp.as_user('c1610000-0000-4000-8000-000000000004');
set local role authenticated;
select lives_ok(
  $$select public.reinstate_account('c1610000-0000-4000-8000-000000000003')$$,
  'the driver can be reinstated'
);
select lives_ok(
  $$select public.suspend_account('c1610000-0000-4000-8000-000000000008', 'temporary', 'held account', now() + interval '3 days', null)$$,
  'admin suspends the held customer'
);
select lives_ok(
  $$select public.suspend_account('c1610000-0000-4000-8000-000000000006', 'temporary', 'short restriction', now() + interval '1 day', null)$$,
  'admin suspends the expiring customer'
);

reset role;
select pg_temp.as_user('c1610000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$select public.assert_driver_can_take_job('c1610000-0000-4000-8000-000000000013', 'offer')$$,
  'This request is no longer available.',
  'a paused request does not mention a suspension'
);

reset role;
update public.account_suspensions
set expires_at = now() - interval '1 minute'
where profile_id = 'c1610000-0000-4000-8000-000000000006' and status = 'active';
select is(
  public.account_is_suspended('c1610000-0000-4000-8000-000000000006'),
  false,
  'an expired time stops the restriction before the scheduled job runs'
);
select lives_ok(
  $$select public.expire_due_suspensions()$$,
  'expiration can be processed'
);
select lives_ok(
  $$select public.expire_due_suspensions()$$,
  'expiration can be processed again'
);
select is(
  (select paused_at is null and not suspension_hold from public.jobs where id = 'c1610000-0000-4000-8000-000000000012'),
  true,
  'a still-open request returns after the suspension ends'
);

select pg_temp.as_user('c1610000-0000-4000-8000-000000000008');
set local role authenticated;
select results_eq(
  $$select public.request_account_deletion()$$,
  $$values ('completed')$$,
  'a suspended customer with no booking can be deleted'
);
reset role;
select is(
  public.phone_is_restricted('5555550198'),
  true,
  'the restricted phone stays blocked without storing the number'
);
select is_empty(
  $$select phone_hmac from public.phone_restrictions where phone_hmac like '%555%'$$,
  'the stored value is not the phone number'
);

select * from finish();
rollback;
