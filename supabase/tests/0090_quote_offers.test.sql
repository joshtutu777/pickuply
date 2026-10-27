-- A new Get a quote request is open. Two drivers can offer. The customer chooses one.

begin;

select plan(14);

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

select pg_temp.make_user('c1900000-0000-4000-8000-000000000001', 'offer-customer@pickuply.test');
select pg_temp.make_user('c1900000-0000-4000-8000-000000000002', 'offer-driver-a@pickuply.test');
select pg_temp.make_user('c1900000-0000-4000-8000-000000000003', 'offer-driver-b@pickuply.test');
select pg_temp.make_user('c1900000-0000-4000-8000-000000000004', 'offer-test-driver@pickuply.test');

select pg_temp.clear_auth();
update public.profiles set full_name = 'Offer Customer' where id = 'c1900000-0000-4000-8000-000000000001';
update public.profiles set full_name = 'Offer Driver A', role = 'driver' where id = 'c1900000-0000-4000-8000-000000000002';
update public.profiles set full_name = 'Offer Driver B', role = 'driver' where id = 'c1900000-0000-4000-8000-000000000003';
update public.profiles set full_name = 'Offer Test Driver', role = 'driver', is_test = true where id = 'c1900000-0000-4000-8000-000000000004';

insert into public.drivers (
  profile_id, status, zone_id, service_level, services, is_online,
  license_expires, terms_version, terms_accepted_at, agreement_signed_at
) values
  ('c1900000-0000-4000-8000-000000000002', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery', 'junk']::public.job_service[], true, current_date + 30, 'driver-terms-v1', now(), now()),
  ('c1900000-0000-4000-8000-000000000003', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery', 'junk']::public.job_service[], true, current_date + 30, 'driver-terms-v1', now(), now()),
  ('c1900000-0000-4000-8000-000000000004', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery', 'junk']::public.job_service[], true, current_date + 30, 'driver-terms-v1', now(), now());

insert into public.vehicles (driver_id, type, make, approved)
values
  ('c1900000-0000-4000-8000-000000000002', 'pickup', 'Ford', true),
  ('c1900000-0000-4000-8000-000000000003', 'pickup', 'Ford', true),
  ('c1900000-0000-4000-8000-000000000004', 'pickup', 'Ford', true);

select pg_temp.as_user('c1900000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.create_customer_request(
    'c1900000-0000-4000-8000-000000000021',
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
      'customer_name', 'Offer Customer',
      'customer_phone', '+14045550190',
      'already_paid', true,
      'seller_holding', false,
      'wants_item_check', true
    )
  )$$,
  'a customer can post a delivery quote'
);
select lives_ok(
  $$select public.create_customer_request(
    'c1900000-0000-4000-8000-000000000022',
    jsonb_build_object(
      'service', 'junk',
      'description', 'Quote sofa',
      'pieces', 1,
      'size', 'medium',
      'item_value_cents', 0,
      'stairs_pickup', 0,
      'elevator', false,
      'help_loading', true,
      'preferred_date', 'asap',
      'pricing_method', 'quote',
      'offer_cents', null,
      'budget_min_cents', null,
      'budget_max_cents', null,
      'dropoff_area', null,
      'dropoff_address', null,
      'stairs_dropoff', null,
      'already_paid', null,
      'seller_holding', null,
      'wants_item_check', null,
      'zone_slug', 'west_metro',
      'pickup_area', 'Austell, 30106',
      'pickup_address', '3 Synthetic Lane',
      'customer_name', 'Offer Customer',
      'customer_phone', '+14045550190',
      'junk_load_size', 'quarter',
      'junk_materials', 'Wood furniture',
      'junk_special_items', jsonb_build_object('mattress', false, 'tires', false, 'appliances', false)
    )
  )$$,
  'a customer can post a junk quote'
);
reset role;

select is(
  (select status::text from public.jobs where id = 'c1900000-0000-4000-8000-000000000021'),
  'open',
  'a delivery quote is open'
);
select is(
  (select status::text from public.jobs where id = 'c1900000-0000-4000-8000-000000000022'),
  'open',
  'a junk quote is open'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method
) values (
  'c1900000-0000-4000-8000-000000000023',
  'c1900000-0000-4000-8000-000000000001',
  'junk',
  'requested',
  (select id from public.zones where slug = 'west_metro'),
  'Austell 30106',
  'Older quote',
  1,
  'medium',
  0,
  0,
  false,
  true,
  'asap',
  'quote'
);

select is(
  (select status::text from public.jobs where id = 'c1900000-0000-4000-8000-000000000023'),
  'requested',
  'an older requested quote stays requested'
);

select pg_temp.as_user('c1900000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'c1900000-0000-4000-8000-000000000021'),
  1,
  'an eligible driver sees the delivery quote'
);
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'c1900000-0000-4000-8000-000000000022'),
  1,
  'an eligible driver sees the junk quote'
);
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'c1900000-0000-4000-8000-000000000023'),
  0,
  'an older requested quote stays off the feed'
);
select lives_ok(
  $$select public.submit_offer('c1900000-0000-4000-8000-000000000021', 'offer', 5000, '')$$,
  'the first driver can offer'
);
reset role;

select pg_temp.as_user('c1900000-0000-4000-8000-000000000004');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'c1900000-0000-4000-8000-000000000021'),
  0,
  'a test driver does not see a real quote'
);
reset role;

select pg_temp.as_user('c1900000-0000-4000-8000-000000000003');
set local role authenticated;
select lives_ok(
  $$select public.submit_offer('c1900000-0000-4000-8000-000000000021', 'offer', 6000, '')$$,
  'a second driver can offer on the same quote'
);
reset role;

select pg_temp.as_user('c1900000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.choose_offer((
    select id from public.job_offers
    where job_id = 'c1900000-0000-4000-8000-000000000021'
      and driver_id = 'c1900000-0000-4000-8000-000000000002'
      and status = 'active'
  ))$$,
  'the customer chooses one offer'
);
reset role;

select is(
  (select assigned_driver_id::text from public.jobs where id = 'c1900000-0000-4000-8000-000000000021'),
  'c1900000-0000-4000-8000-000000000002',
  'only the chosen driver is assigned'
);

select pg_temp.as_user('c1900000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$select public.submit_offer('c1900000-0000-4000-8000-000000000021', 'offer', 7000, '')$$,
  'this driver cannot offer on this job',
  'a second assignment cannot be offered'
);
reset role;

select * from finish();
rollback;
