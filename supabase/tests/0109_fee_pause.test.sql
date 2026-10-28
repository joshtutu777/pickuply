-- Local only. A zero fee releases the hold. A stored fee on an old job stays put.

begin;

select plan(22);

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
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.clear_auth()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
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
end $$;

select pg_temp.make_user('c1090000-0000-4000-8000-000000000001', 'fee-customer@pickuply.test');
select pg_temp.make_user('c1090000-0000-4000-8000-000000000002', 'fee-driver@pickuply.test');
select pg_temp.make_user('c1090000-0000-4000-8000-000000000003', 'fee-admin@pickuply.test');
select pg_temp.make_user('c1090000-0000-4000-8000-000000000004', 'fee-other@pickuply.test');

update public.profiles set role = 'driver', full_name = 'Fee Driver' where id = 'c1090000-0000-4000-8000-000000000002';
update public.profiles set role = 'admin', full_name = 'Fee Admin' where id = 'c1090000-0000-4000-8000-000000000003';
update public.profiles set full_name = 'Fee Customer' where id = 'c1090000-0000-4000-8000-000000000001';

insert into public.drivers (
  profile_id, status, zone_id, service_level, services, max_distance_miles, is_online,
  license_url, license_expires, insurance_expires, insurance_url
) values (
  'c1090000-0000-4000-8000-000000000002', 'active',
  (select id from public.zones where slug = 'west_metro'),
  'full', array['delivery']::public.job_service[], 25, true,
  'c1090000-0000-4000-8000-000000000002/license.jpg', current_date + 30,
  current_date + 30, 'c1090000-0000-4000-8000-000000000002/insurance.jpg'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date,
  pricing_method, service_level, required_vehicle
) values
  ('c1090000-0000-4000-8000-000000000011', 'c1090000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'zero cancel', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 'full', 'pickup'),
  ('c1090000-0000-4000-8000-000000000012', 'c1090000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'old fee', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 'full', 'pickup'),
  ('c1090000-0000-4000-8000-000000000013', 'c1090000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'fee on', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 'full', 'pickup'),
  ('c1090000-0000-4000-8000-000000000014', 'c1090000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'en route', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 'full', 'pickup'),
  ('c1090000-0000-4000-8000-000000000015', 'c1090000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'reject zero', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 'full', 'pickup'),
  ('c1090000-0000-4000-8000-000000000016', 'c1090000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'reject on', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 'full', 'pickup'),
  ('c1090000-0000-4000-8000-000000000017', 'c1090000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'no show', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 'full', 'pickup'),
  ('c1090000-0000-4000-8000-000000000018', 'c1090000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'auth once', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 'full', 'pickup');

select pg_temp.clear_auth();

update public.jobs
set status = 'assigned', assigned_driver_id = 'c1090000-0000-4000-8000-000000000002',
    payment_status = 'authorized', payment_due_at = now() + interval '30 minutes',
    price_cents = 5250, driver_pay_cents = 4250, platform_fee_cents = 750, service_fee_cents = 250
where id = 'c1090000-0000-4000-8000-000000000011';

update public.jobs
set status = 'cancelled', assigned_driver_id = 'c1090000-0000-4000-8000-000000000002',
    payment_status = 'captured', late_cancel_cents = 1500, fee_driver_cents = 0,
    price_cents = 5250, driver_pay_cents = 4250, platform_fee_cents = 750, service_fee_cents = 250,
    captured_cents = 1500
where id = 'c1090000-0000-4000-8000-000000000012';

update public.jobs
set status = 'assigned', assigned_driver_id = 'c1090000-0000-4000-8000-000000000002',
    payment_status = 'authorized', payment_due_at = now() + interval '30 minutes',
    price_cents = 5250, driver_pay_cents = 4250, platform_fee_cents = 750, service_fee_cents = 250
where id = 'c1090000-0000-4000-8000-000000000013';

update public.jobs
set status = 'assigned', assigned_driver_id = 'c1090000-0000-4000-8000-000000000002',
    payment_status = 'awaiting_payment', payment_due_at = now() + interval '30 minutes',
    price_cents = 5250, driver_pay_cents = 4250, platform_fee_cents = 750, service_fee_cents = 250
where id = 'c1090000-0000-4000-8000-000000000018';

update public.jobs
set status = 'en_route', assigned_driver_id = 'c1090000-0000-4000-8000-000000000002',
    payment_status = 'authorized',
    price_cents = 5250, driver_pay_cents = 4250, platform_fee_cents = 750, service_fee_cents = 250
where id = 'c1090000-0000-4000-8000-000000000014';

update public.jobs
set status = 'item_check', assigned_driver_id = 'c1090000-0000-4000-8000-000000000002',
    payment_status = 'authorized',
    price_cents = 5250, driver_pay_cents = 4250, platform_fee_cents = 750, service_fee_cents = 250
where id in (
  'c1090000-0000-4000-8000-000000000015',
  'c1090000-0000-4000-8000-000000000016'
);

update public.jobs
set status = 'arrived', assigned_driver_id = 'c1090000-0000-4000-8000-000000000002',
    payment_status = 'authorized', no_show_pending = true,
    price_cents = 5250, driver_pay_cents = 4250, platform_fee_cents = 750, service_fee_cents = 250
where id = 'c1090000-0000-4000-8000-000000000017';

insert into public.job_payments (job_id, payment_intent_id, checkout_attempt, checkout_driver_id)
values
  ('c1090000-0000-4000-8000-000000000011', 'pi_fee0109a', 1, 'c1090000-0000-4000-8000-000000000002'),
  ('c1090000-0000-4000-8000-000000000013', 'pi_fee0109b', 1, 'c1090000-0000-4000-8000-000000000002'),
  ('c1090000-0000-4000-8000-000000000014', 'pi_fee0109c', 1, 'c1090000-0000-4000-8000-000000000002'),
  ('c1090000-0000-4000-8000-000000000018', 'pi_fee0109d', 1, 'c1090000-0000-4000-8000-000000000002');

select is((select late_cancel_fee_cents from public.platform_settings where id = 1), 0, 'late-cancel setting is off');
select is((select trip_fee_cents from public.platform_settings where id = 1), 0, 'trip-fee setting is off');

select pg_temp.as_user('c1090000-0000-4000-8000-000000000004');
select throws_ok(
  $$select public.begin_customer_cancel('c1090000-0000-4000-8000-000000000011')$$,
  'P0001',
  'only the customer can cancel this job',
  'another person cannot cancel'
);

select pg_temp.as_user('c1090000-0000-4000-8000-000000000001');
select is(
  (public.begin_customer_cancel('c1090000-0000-4000-8000-000000000011')->>'outcome'),
  'release',
  'a zero late-cancel fee releases the hold'
);
select is(
  (select late_cancel_cents from public.jobs where id = 'c1090000-0000-4000-8000-000000000011'),
  null,
  'the zero-fee cancel does not store a late-cancel amount'
);
select is(
  (select late_cancel_cents from public.jobs where id = 'c1090000-0000-4000-8000-000000000012'),
  1500,
  'an older late-cancel record stays'
);

update public.platform_settings set late_cancel_fee_cents = 1500, trip_fee_cents = 2500 where id = 1;

select is(
  (public.begin_customer_cancel('c1090000-0000-4000-8000-000000000013')->>'outcome'),
  'late_cancel',
  'a configured late-cancel fee can still be recorded'
);
select is(
  (select late_cancel_cents from public.jobs where id = 'c1090000-0000-4000-8000-000000000013'),
  1500,
  'the configured late-cancel amount is stored'
);
select is(
  (select fee_driver_cents from public.jobs where id = 'c1090000-0000-4000-8000-000000000013'),
  0,
  'the driver share stays zero before the trip starts'
);
select is(
  (public.begin_customer_cancel('c1090000-0000-4000-8000-000000000014')->>'outcome'),
  'late_cancel',
  'an in-progress cancel still uses the configured fee'
);
select is(
  (select fee_driver_cents from public.jobs where id = 'c1090000-0000-4000-8000-000000000014'),
  1000,
  'the in-progress driver share stays $10 when the fee is $15'
);

update public.platform_settings set trip_fee_cents = 0 where id = 1;
select pg_temp.as_user('c1090000-0000-4000-8000-000000000001');
select lives_ok(
  $$select public.reject_pickup('c1090000-0000-4000-8000-000000000015', 'Wrong item')$$,
  'a zero trip fee still rejects the item'
);
select is(
  (select trip_fee_cents from public.jobs where id = 'c1090000-0000-4000-8000-000000000015'),
  null,
  'a zero trip fee is not stored on the job'
);

update public.platform_settings set trip_fee_cents = 2500 where id = 1;
select lives_ok(
  $$select public.reject_pickup('c1090000-0000-4000-8000-000000000016', 'Wrong item')$$,
  'a configured trip fee can still be recorded'
);
select is(
  (select trip_fee_cents from public.jobs where id = 'c1090000-0000-4000-8000-000000000016'),
  2500,
  'the configured trip fee is stored'
);
select is(
  (select fee_driver_cents from public.jobs where id = 'c1090000-0000-4000-8000-000000000016'),
  2000,
  'the trip-fee driver share stays $20 when the fee is $25'
);

select pg_temp.as_user('c1090000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.confirm_customer_no_show('c1090000-0000-4000-8000-000000000017')$$,
  'P0001',
  'only an admin can confirm a no-show fee',
  'a customer cannot confirm a no-show'
);

update public.platform_settings set trip_fee_cents = 0 where id = 1;
select pg_temp.as_user('c1090000-0000-4000-8000-000000000003');
select lives_ok(
  $$select public.confirm_customer_no_show('c1090000-0000-4000-8000-000000000017')$$,
  'an admin can close a no-show while the trip fee is off'
);
select is(
  (select trip_fee_cents from public.jobs where id = 'c1090000-0000-4000-8000-000000000017'),
  null,
  'a no-show does not store a trip fee while the setting is off'
);

select pg_temp.clear_auth();
select is(
  public.apply_authorization(
    'c1090000-0000-4000-8000-000000000018',
    'pi_fee0109d',
    'ch_fee0109d',
    now() + interval '5 days',
    'c1090000-0000-4000-8000-000000000002'
  ),
  'accepted',
  'the first authorization is recorded'
);
select is(
  public.apply_authorization(
    'c1090000-0000-4000-8000-000000000018',
    'pi_fee0109d',
    'ch_fee0109d',
    now() + interval '5 days',
    'c1090000-0000-4000-8000-000000000002'
  ),
  'accepted',
  'a repeated authorization does not create another booking'
);
select is(
  (select count(*)::int from public.job_events where job_id = 'c1090000-0000-4000-8000-000000000018' and type = 'payment_authorized'),
  1,
  'one payment event is stored'
);

select * from finish();
rollback;
