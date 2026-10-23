-- Local Supabase only. Assignment, documents, and payment cannot be bypassed.

begin;

select plan(41);

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

create or replace function pg_temp.clear_auth()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
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

select pg_temp.make_user('d1111111-1111-4111-8111-111111111111', 'sec-customer@pickuply.test');
select pg_temp.make_user('d3333333-3333-4333-8333-333333333333', 'sec-admin@pickuply.test');
select pg_temp.make_user('d4444444-4444-4444-8444-444444444444', 'sec-driver@pickuply.test');
select pg_temp.make_user('d5555555-5555-4555-8555-555555555555', 'sec-other@pickuply.test');
select pg_temp.make_user('d6666666-6666-4666-8666-666666666666', 'sec-applicant@pickuply.test');

update public.profiles set role = 'admin', full_name = 'Sec Admin' where id = 'd3333333-3333-4333-8333-333333333333';
update public.profiles set role = 'driver', full_name = 'Sec Driver' where id = 'd4444444-4444-4444-8444-444444444444';
update public.profiles set role = 'driver', full_name = 'Other Driver' where id = 'd5555555-5555-4555-8555-555555555555';
update public.profiles set full_name = 'Sec Customer' where id = 'd1111111-1111-4111-8111-111111111111';
update public.profiles set full_name = 'Sec Applicant' where id = 'd6666666-6666-4666-8666-666666666666';

insert into public.drivers (
  profile_id, status, zone_id, service_level, services, max_distance_miles, is_online,
  license_url, license_expires, insurance_expires, insurance_url
) values
  (
    'd4444444-4444-4444-8444-444444444444', 'active',
    (select id from public.zones where slug = 'west_metro'),
    'full', array['delivery']::public.job_service[], 25, true,
    'd4444444-4444-4444-8444-444444444444/license.jpg', current_date + 30,
    current_date + 30, 'd4444444-4444-4444-8444-444444444444/insurance.jpg'
  ),
  (
    'd5555555-5555-4555-8555-555555555555', 'active',
    (select id from public.zones where slug = 'east_gwinnett'),
    'full', array['delivery']::public.job_service[], 25, true,
    'd5555555-5555-4555-8555-555555555555/license.jpg', current_date + 30,
    current_date + 30, 'd5555555-5555-4555-8555-555555555555/insurance.jpg'
  ),
  (
    'd6666666-6666-4666-8666-666666666666', 'pending_review',
    (select id from public.zones where slug = 'west_metro'),
    'full', array['delivery']::public.job_service[], 25, false,
    'd6666666-6666-4666-8666-666666666666/license.jpg', current_date + 30,
    current_date + 30, 'd6666666-6666-4666-8666-666666666666/insurance.jpg'
  );

insert into public.vehicles (driver_id, type, make, approved) values
  ('d4444444-4444-4444-8444-444444444444', 'pickup', 'Ford', true),
  ('d5555555-5555-4555-8555-555555555555', 'pickup', 'Ford', true),
  ('d6666666-6666-4666-8666-666666666666', 'pickup', 'Ford', false);

select set_config('pickuply.quote_accepted', 'yes', true);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date,
  pricing_method, offer_cents, service_level, required_vehicle,
  price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents
) values
  (
    'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'd1111111-1111-4111-8111-111111111111',
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell 30168', 'private description', 1, 'medium', 0, 0, false, false, 'asap',
    'quote', null, 'full', 'pickup', 7240, 6000, 1000, 240
  ),
  (
    'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'd1111111-1111-4111-8111-111111111111',
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell 30168', 'private description', 1, 'medium', 0, 0, false, false, 'asap',
    'fixed', 6000, 'full', 'pickup', null, null, null, null
  );

select set_config('pickuply.quote_accepted', '', true);

insert into public.job_private (job_id, pickup_address, customer_name, customer_phone)
values (
  'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '100 Market Street',
  'Sec Customer',
  '+15555550111'
);

insert into public.job_offers (
  job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents,
  customer_total_cents, outside_range, status, expires_at
) values (
  'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'd4444444-4444-4444-8444-444444444444',
  'accept', 6000, 0, 0, 6000, false, 'active', now() + interval '2 hours'
);

insert into storage.objects (bucket_id, name, owner_id) values
  ('driver-docs', 'd4444444-4444-4444-8444-444444444444/license.jpg', 'd4444444-4444-4444-8444-444444444444'),
  ('job-photos', 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/request/a.jpg', 'd1111111-1111-4111-8111-111111111111'),
  ('job-photos', 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/pickup/b.jpg', 'd4444444-4444-4444-8444-444444444444');

select pg_temp.as_user('d4444444-4444-4444-8444-444444444444');
set local role authenticated;

select throws_ok(
  $$update public.drivers set license_expires = current_date + 400 where profile_id = auth.uid()$$,
  'only an admin can change driver approval fields',
  'an approved driver cannot change license expiry'
);
select throws_ok(
  $$update public.drivers set insurance_expires = current_date + 400 where profile_id = auth.uid()$$,
  'only an admin can change driver approval fields',
  'an approved driver cannot change insurance expiry'
);
select throws_ok(
  $$update public.drivers set status = 'removed' where profile_id = auth.uid()$$,
  'only an admin can change driver status',
  'an approved driver cannot change approval status'
);
select throws_ok(
  $$update public.profiles set role = 'admin' where id = auth.uid()$$,
  'users cannot change their own role',
  'a driver cannot change their own role'
);
select throws_ok(
  $$update public.vehicles set approved = false where driver_id = auth.uid()$$,
  'only an admin can approve a vehicle',
  'a driver cannot approve their own vehicle'
);
select throws_ok(
  $$select public.admin_assign_driver('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', auth.uid())$$,
  'only an admin can assign a driver',
  'a driver cannot assign a job'
);

select is(
  (select count(*)::int from public.job_offers where job_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  1,
  'a driver can read their own offer'
);
select is(
  (select count(*)::int from storage.objects where name = 'd4444444-4444-4444-8444-444444444444/license.jpg'),
  1,
  'a driver can read their own documents'
);
select is(
  (select count(*)::int from storage.objects where name = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/request/a.jpg'),
  1,
  'an eligible driver can read a request photo'
);
select is(
  (select count(*)::int from storage.objects where name = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/pickup/b.jpg'),
  0,
  'an eligible driver cannot read a pickup photo'
);

reset role;
select pg_temp.as_user('d5555555-5555-4555-8555-555555555555');
set local role authenticated;

select is(
  (select count(*)::int from public.job_offers where job_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  0,
  'a driver cannot read another driver offer'
);
select is(
  (select count(*)::int from storage.objects where name = 'd4444444-4444-4444-8444-444444444444/license.jpg'),
  0,
  'a driver cannot read another driver documents'
);
select is(
  (select count(*)::int from storage.objects where name = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/request/a.jpg'),
  1,
  'a driver outside the job zone can read a request photo'
);
select is(
  (select count(*)::int from public.job_private where pickup_address = '100 Market Street'),
  0,
  'an unassigned driver cannot read the street address'
);

reset role;
select pg_temp.as_user('d3333333-3333-4333-8333-333333333333');
set local role authenticated;

select throws_ok(
  $$update public.vehicles set approved = true where driver_id = 'd6666666-6666-4666-8666-666666666666'$$,
  'only an admin can approve a vehicle',
  'vehicle approval has to go through driver review'
);
select lives_ok(
  $$select public.review_driver('d6666666-6666-4666-8666-666666666666', 'approve_new', null)$$,
  'an admin can approve a driver'
);
select is(
  (select status from public.drivers where profile_id = 'd6666666-6666-4666-8666-666666666666'),
  'approved_new',
  'approval sets the driver status'
);
select is(
  (select approved from public.vehicles where driver_id = 'd6666666-6666-4666-8666-666666666666'),
  true,
  'approval approves the vehicle'
);
select ok(
  exists (
    select 1 from public.audit_log
    where actor_id = 'd3333333-3333-4333-8333-333333333333' and action = 'review_driver'
  ),
  'driver review writes an audit row'
);
select ok(
  exists (
    select 1 from public.audit_log
    where actor_id = 'd3333333-3333-4333-8333-333333333333' and action = 'approve_vehicle'
  ),
  'vehicle approval writes an audit row'
);
select throws_ok(
  $$update public.jobs set status = 'assigned', assigned_driver_id = 'd4444444-4444-4444-8444-444444444444' where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,
  'only an admin can assign a driver',
  'a direct admin update cannot assign a driver'
);
select lives_ok(
  $$select public.admin_assign_driver('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'd4444444-4444-4444-8444-444444444444')$$,
  'an admin assigns through the audited function'
);
select is(
  (select assigned_driver_id from public.jobs where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'd4444444-4444-4444-8444-444444444444'::uuid,
  'the audited assign names one driver'
);
select is(
  (select payment_status from public.jobs where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'awaiting_payment',
  'assignment waits for payment'
);
select ok(
  (select payment_due_at is not null from public.jobs where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'assignment sets a payment deadline'
);
select ok(
  (select stripe_payment_intent_id is null from public.jobs where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'assignment does not create a Stripe payment'
);
select ok(
  exists (
    select 1 from public.audit_log
    where actor_id = 'd3333333-3333-4333-8333-333333333333' and action = 'assign_driver'
  ),
  'assignment writes an audit row'
);
select is(
  (select count(*)::int from storage.objects where name = 'd4444444-4444-4444-8444-444444444444/license.jpg'),
  1,
  'an admin can read driver documents'
);

reset role;
select pg_temp.as_user('d4444444-4444-4444-8444-444444444444');
set local role authenticated;
update public.jobs
set payment_status = 'paid'
where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
update public.jobs
set status = 'en_route'
where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
select throws_ok(
  $$select public.update_platform_settings(1000, 1000, 290, 30, 45)$$,
  'only an admin can change settings',
  'a driver cannot change settings'
);

reset role;
select pg_temp.as_user('d1111111-1111-4111-8111-111111111111');
set local role authenticated;
update public.jobs
set payment_status = 'authorized', payment_due_at = null
where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

reset role;
select pg_temp.clear_auth();

select is(
  (select payment_status from public.jobs where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'awaiting_payment',
  'a driver or customer update cannot change payment status'
);
select ok(
  (select payment_due_at is not null from public.jobs where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'a customer update cannot clear the payment deadline'
);
select is(
  (select status from public.jobs where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'assigned',
  'a driver update cannot move the job to en route'
);
select throws_ok(
  $$update public.jobs set status = 'en_route' where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,
  'payment must be authorized before work starts',
  'the database blocks en route before payment'
);

select pg_temp.as_user('d3333333-3333-4333-8333-333333333333');
set local role authenticated;
select lives_ok(
  $$update public.jobs set payment_status = 'authorized' where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,
  'an admin can record that payment is authorized'
);
select ok(
  exists (
    select 1 from public.audit_log
    where action = 'set_payment_status' and target_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'an admin payment change is audited'
);
select lives_ok(
  $$select public.update_platform_settings(1000, 1000, 290, 30, 45)$$,
  'an admin can change the payment deadline'
);
select is(
  (select payment_due_minutes from public.platform_settings where id = 1),
  45,
  'the payment deadline setting is stored'
);
select ok(
  exists (
    select 1 from public.audit_log
    where actor_id = 'd3333333-3333-4333-8333-333333333333' and action = 'update_platform_settings'
  ),
  'a settings change writes an audit row'
);

reset role;
select pg_temp.clear_auth();
select lives_ok(
  $$update public.jobs set status = 'en_route' where id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,
  'work can start after payment is authorized'
);

select ok(
  position('phone' in pg_get_function_result('public.offer_summaries(uuid)'::regprocedure)) = 0
    and position('address' in pg_get_function_result('public.offer_summaries(uuid)'::regprocedure)) = 0,
  'offer summaries do not return a phone or address'
);
select ok(
  position('assert_driver_can_take_job' in pg_get_functiondef('public.claim_job(uuid)'::regprocedure)) > 0
    and position('assert_driver_can_take_job' in pg_get_functiondef('public.submit_offer(uuid, text, integer, text)'::regprocedure)) > 0
    and position('driver_is_eligible_for_job' in pg_get_functiondef('public.assert_driver_can_take_job(uuid, text)'::regprocedure)) > 0
    and position('driver_is_eligible_for_job' in pg_get_functiondef('public.request_photo_visible(uuid)'::regprocedure)) > 0,
  'claim, offer, and request photo checks use eligibility'
);

select * from finish();
rollback;
