-- Local only. Private rows stay in their lane, and a quote stays off the driver feed until it is accepted.

begin;

select plan(38);

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

select set_config('pickuply.phone_hmac_secret', 'local-test-secret', true);
select pg_temp.make_user('c1760000-0000-4000-8000-000000000001', 'uat-customer@pickuply.test');
select pg_temp.make_user('c1760000-0000-4000-8000-000000000002', 'uat-driver@pickuply.test');
select pg_temp.make_user('c1760000-0000-4000-8000-000000000003', 'uat-other@pickuply.test');
select pg_temp.make_user('c1760000-0000-4000-8000-000000000004', 'uat-admin@pickuply.test');
select pg_temp.make_user('c1760000-0000-4000-8000-000000000005', 'uat-test-admin@pickuply.test');
select pg_temp.make_user('c1760000-0000-4000-8000-000000000006', 'uat-other-driver@pickuply.test');
select pg_temp.make_user('c1760000-0000-4000-8000-000000000007', 'uat-test-customer@pickuply.test');
select pg_temp.clear_auth();

update public.platform_settings set waves_enabled = false where id = 1;
update public.profiles set full_name = 'UAT Customer' where id = 'c1760000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'UAT Driver' where id = 'c1760000-0000-4000-8000-000000000002';
update public.profiles set full_name = 'UAT Other' where id = 'c1760000-0000-4000-8000-000000000003';
update public.profiles set role = 'admin', full_name = 'UAT Admin' where id = 'c1760000-0000-4000-8000-000000000004';
update public.profiles set role = 'admin', full_name = 'UAT Test Admin', is_test = true where id = 'c1760000-0000-4000-8000-000000000005';
update public.profiles set role = 'driver', full_name = 'UAT Other Driver' where id = 'c1760000-0000-4000-8000-000000000006';
update public.profiles set full_name = 'UAT Test Customer', is_test = true where id = 'c1760000-0000-4000-8000-000000000007';

insert into public.drivers (
  profile_id, status, zone_id, service_level, services, is_online,
  license_expires, terms_version, terms_accepted_at, agreement_signed_at
) values
  ('c1760000-0000-4000-8000-000000000002', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], true, current_date + 30, 'driver-terms-v1', now(), now()),
  ('c1760000-0000-4000-8000-000000000006', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery']::public.job_service[], true, current_date + 30, 'driver-terms-v1', now(), now());

insert into public.vehicles (driver_id, type, make, approved)
values ('c1760000-0000-4000-8000-000000000002', 'pickup', 'Ford', true);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values
  ('c1760000-0000-4000-8000-000000000011', 'c1760000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30106', 'real lane', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1760000-0000-4000-8000-000000000012', 'c1760000-0000-4000-8000-000000000007', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30106', 'test lane', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000);

insert into public.job_private (job_id, pickup_address, customer_name, customer_phone)
values
  ('c1760000-0000-4000-8000-000000000011', '1 Synthetic Lane', 'UAT Customer', '+14045550101'),
  ('c1760000-0000-4000-8000-000000000012', '2 Synthetic Lane', 'UAT Test Customer', '+14045550102');

update public.jobs
set status = 'assigned', assigned_driver_id = 'c1760000-0000-4000-8000-000000000002', payment_status = 'authorized'
where id = 'c1760000-0000-4000-8000-000000000011';

insert into public.job_photos (job_id, stage, storage_path, uploaded_by)
values (
  'c1760000-0000-4000-8000-000000000011',
  'request',
  'c1760000-0000-4000-8000-000000000011/request/lane.jpg',
  'c1760000-0000-4000-8000-000000000001'
);
insert into storage.objects (bucket_id, name, owner_id)
values (
  'job-photos',
  'c1760000-0000-4000-8000-000000000011/request/lane.jpg',
  'c1760000-0000-4000-8000-000000000001'
);

select ok(public.contains_contact('Call me at 555-0100'), 'a short separated phone is contact');
select ok(not public.contains_contact('2 items'), 'an item count is not contact');
select ok(not public.contains_contact('ZIP 30106'), 'a ZIP is not contact');
select ok(not public.contains_contact('See you at 3'), 'a clock time is not contact');

select pg_temp.as_user('c1760000-0000-4000-8000-000000000005');
set local role authenticated;
select is(
  (select count(*)::int from public.job_private where job_id = 'c1760000-0000-4000-8000-000000000011'),
  0,
  'a synthetic admin cannot read a real private row'
);
select is(
  (select count(*)::int from public.job_photos where job_id = 'c1760000-0000-4000-8000-000000000011'),
  0,
  'a synthetic admin cannot read a real job photo'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'job-photos' and name = 'c1760000-0000-4000-8000-000000000011/request/lane.jpg'),
  0,
  'a synthetic admin cannot read a real job photo file'
);
select is(
  (select count(*)::int from public.job_private where job_id = 'c1760000-0000-4000-8000-000000000012'),
  1,
  'a synthetic admin can read a synthetic private row'
);
reset role;

select pg_temp.as_user('c1760000-0000-4000-8000-000000000004');
set local role authenticated;
select is(
  (select count(*)::int from public.job_private where job_id = 'c1760000-0000-4000-8000-000000000011'),
  1,
  'a real admin can read a real private row'
);
select is(
  (select count(*)::int from public.job_photos where job_id = 'c1760000-0000-4000-8000-000000000011'),
  1,
  'a real admin can read a real job photo'
);
reset role;

select pg_temp.as_user('c1760000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (select count(*)::int from public.job_private where job_id = 'c1760000-0000-4000-8000-000000000011'),
  1,
  'a customer can read their own private row'
);
select is(
  (select count(*)::int from public.job_photos where job_id = 'c1760000-0000-4000-8000-000000000011'),
  1,
  'a customer can read their own job photo'
);
reset role;

select pg_temp.as_user('c1760000-0000-4000-8000-000000000003');
set local role authenticated;
select is(
  (select count(*)::int from public.job_private where job_id = 'c1760000-0000-4000-8000-000000000011'),
  0,
  'another customer cannot read the private row'
);
reset role;

select pg_temp.as_user('c1760000-0000-4000-8000-000000000006');
set local role authenticated;
select is(
  (select count(*)::int from public.job_private where job_id = 'c1760000-0000-4000-8000-000000000011'),
  0,
  'an unassigned driver cannot read the private row'
);
select is(
  (select count(*)::int from public.job_photos where job_id = 'c1760000-0000-4000-8000-000000000011'),
  0,
  'an unassigned driver cannot read the job photo'
);
reset role;

select pg_temp.as_user('c1760000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::int from public.job_private where job_id = 'c1760000-0000-4000-8000-000000000011'),
  1,
  'the assigned driver can read the private row'
);
select is(
  (select count(*)::int from public.job_photos where job_id = 'c1760000-0000-4000-8000-000000000011'),
  1,
  'the assigned driver can read the job photo'
);
reset role;
select pg_temp.clear_auth();

select pg_temp.as_user('c1760000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.create_customer_request(
    'c1760000-0000-4000-8000-000000000021',
    jsonb_build_object(
      'service', 'delivery',
      'description', 'Quote dresser',
      'pieces', 1,
      'size', 'medium',
      'item_value_cents', 8000,
      'stairs_pickup', 0,
      'stairs_dropoff', 0,
      'elevator', false,
      'help_loading', true,
      'preferred_date', 'asap',
      'pricing_method', 'quote',
      'offer_cents', null,
      'budget_min_cents', null,
      'budget_max_cents', null,
      'zone_slug', 'west_metro',
      'pickup_area', 'Austell, 30106',
      'pickup_address', '1 Synthetic Lane',
      'dropoff_area', 'Smyrna, 30080',
      'dropoff_address', '2 Synthetic Lane',
      'customer_name', 'UAT Customer',
      'customer_phone', '+14045550101',
      'already_paid', true,
      'seller_holding', false,
      'wants_item_check', true
    )
  )$$,
  'a customer can submit a quote'
);
select lives_ok(
  $$select public.create_customer_request(
    'c1760000-0000-4000-8000-000000000022',
    jsonb_build_object(
      'service', 'delivery',
      'description', 'Named dresser',
      'pieces', 1,
      'size', 'medium',
      'item_value_cents', 8000,
      'stairs_pickup', 0,
      'stairs_dropoff', 0,
      'elevator', false,
      'help_loading', true,
      'preferred_date', 'asap',
      'pricing_method', 'fixed',
      'offer_cents', 6000,
      'budget_min_cents', null,
      'budget_max_cents', null,
      'zone_slug', 'west_metro',
      'pickup_area', 'Austell, 30106',
      'pickup_address', '1 Synthetic Lane',
      'dropoff_area', 'Smyrna, 30080',
      'dropoff_address', '2 Synthetic Lane',
      'customer_name', 'UAT Customer',
      'customer_phone', '+14045550101',
      'already_paid', true,
      'seller_holding', false,
      'wants_item_check', true
    )
  )$$,
  'a customer can submit a named price'
);
reset role;
select pg_temp.clear_auth();

select is(
  (select status::text from public.jobs where id = 'c1760000-0000-4000-8000-000000000021'),
  'requested',
  'a quote waits for an admin price'
);
select is(
  (select status::text from public.jobs where id = 'c1760000-0000-4000-8000-000000000022'),
  'open',
  'a named price opens immediately'
);

select pg_temp.as_user('c1760000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'c1760000-0000-4000-8000-000000000021'),
  0,
  'a driver does not see a quote before it is accepted'
);
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'c1760000-0000-4000-8000-000000000022'),
  1,
  'a driver sees a named price immediately'
);
reset role;

select is(public.booking_date_allowed(to_char((timezone('America/New_York', now()))::date, 'YYYY-MM-DD')), true, 'today is inside the booking window');
select is(public.booking_date_allowed(to_char((timezone('America/New_York', now()))::date + 6, 'YYYY-MM-DD')), true, 'the sixth day is inside the booking window');
select is(public.booking_date_allowed(to_char((timezone('America/New_York', now()))::date - 1, 'YYYY-MM-DD')), false, 'yesterday is outside the booking window');
select is(public.booking_date_allowed(to_char((timezone('America/New_York', now()))::date + 7, 'YYYY-MM-DD')), false, 'the seventh day is outside the booking window');
select throws_ok(
  format(
    $q$update public.jobs set preferred_date = %L where id = 'c1760000-0000-4000-8000-000000000022'$q$,
    to_char((timezone('America/New_York', now()))::date + 7, 'YYYY-MM-DD')
  ),
  'Choose a date within the next 6 days.',
  'saving a date seven days out is rejected'
);
select lives_ok(
  format(
    $q$update public.jobs set preferred_date = %L where id = 'c1760000-0000-4000-8000-000000000022'$q$,
    to_char((timezone('America/New_York', now()))::date + 6, 'YYYY-MM-DD')
  ),
  'saving a date six days out is allowed'
);

select pg_temp.as_user('c1760000-0000-4000-8000-000000000004');
set local role authenticated;
select lives_ok(
  format(
    $q$select public.review_request(
      'c1760000-0000-4000-8000-000000000021',
      'quote',
      jsonb_build_object(
        'service_level', 'light',
        'required_vehicle', 'pickup',
        'driver_pay_cents', 5000,
        'dump_fee_cents', 0,
        'time_window', 'morning',
        'preferred_date', %L,
        'expires_hours', 24
      )
    )$q$,
    to_char((timezone('America/New_York', now()))::date, 'YYYY-MM-DD')
  ),
  'an admin can send a quote price'
);
reset role;

select pg_temp.as_user('c1760000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'c1760000-0000-4000-8000-000000000021'),
  0,
  'a driver does not see a quote before the customer accepts it'
);
reset role;

select pg_temp.as_user('c1760000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.accept_admin_quote('c1760000-0000-4000-8000-000000000021')$$,
  'the customer can accept the quote'
);
reset role;

select pg_temp.as_user('c1760000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'c1760000-0000-4000-8000-000000000021'),
  1,
  'a driver sees the quote after the customer accepts it'
);
select throws_ok(
  $$select public.submit_offer('c1760000-0000-4000-8000-000000000021', 'offer', 5000, '')$$,
  'a quote is claimed after the customer accepts it',
  'a driver cannot price a quote'
);
select lives_ok(
  $$select public.claim_job('c1760000-0000-4000-8000-000000000021')$$,
  'the driver can claim the accepted quote'
);
reset role;
select pg_temp.clear_auth();

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents, commission_bps
) values (
  'c1760000-0000-4000-8000-000000000031',
  'c1760000-0000-4000-8000-000000000001',
  'delivery', 'completed', (select id from public.zones where slug = 'west_metro'),
  'Austell 30106', 'historical real', 1, 'medium', 0, 0, false, false, 'asap', 'fixed',
  6354, 5000, 1000, 354, 1500
);

update public.jobs
set description = 'historical real unchanged'
where id = 'c1760000-0000-4000-8000-000000000031';

select is(
  (select commission_bps from public.jobs where id = 'c1760000-0000-4000-8000-000000000031'),
  1500,
  'a stored real commission label is not rewritten'
);
select is(
  (select price_cents from public.jobs where id = 'c1760000-0000-4000-8000-000000000031'),
  6354,
  'a stored real price is not rewritten'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values (
  'c1760000-0000-4000-8000-000000000032',
  'c1760000-0000-4000-8000-000000000007',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30106', 'synthetic label', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000
);

select set_config('pickuply.job_claimed', '', true);
select set_config('pickuply.offer_chosen', '', true);
update public.jobs
set driver_pay_cents = 5000, platform_fee_cents = 1000, price_cents = 6354, service_fee_cents = 354
where id = 'c1760000-0000-4000-8000-000000000032';

select is(
  (select commission_bps from public.jobs where id = 'c1760000-0000-4000-8000-000000000032'),
  1667,
  'a synthetic fee label matches the stored cents'
);

select * from finish();
rollback;
