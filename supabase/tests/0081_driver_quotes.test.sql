-- A Get a quote request stays off the driver feed until the customer accepts the admin price.

begin;

select plan(4);

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

select pg_temp.make_user('c1810000-0000-4000-8000-000000000001', 'quote-customer@pickuply.test');
select pg_temp.make_user('c1810000-0000-4000-8000-000000000002', 'quote-driver@pickuply.test');
select pg_temp.make_user('c1810000-0000-4000-8000-000000000003', 'quote-test-driver@pickuply.test');

select pg_temp.clear_auth();
update public.profiles set full_name = 'Quote Customer' where id = 'c1810000-0000-4000-8000-000000000001';
update public.profiles set full_name = 'Quote Driver', role = 'driver' where id = 'c1810000-0000-4000-8000-000000000002';
update public.profiles set full_name = 'Other Lane Driver', role = 'driver', is_test = true where id = 'c1810000-0000-4000-8000-000000000003';

insert into public.drivers (
  profile_id, status, zone_id, service_level, services, is_online,
  license_expires, terms_version, terms_accepted_at, agreement_signed_at
)
values
  (
    'c1810000-0000-4000-8000-000000000002',
    'active',
    (select id from public.zones where slug = 'west_metro'),
    'light',
    array['delivery']::public.job_service[],
    true,
    current_date + 30,
    'driver-terms-v2',
    now(),
    now()
  ),
  (
    'c1810000-0000-4000-8000-000000000003',
    'active',
    (select id from public.zones where slug = 'west_metro'),
    'light',
    array['delivery']::public.job_service[],
    true,
    current_date + 30,
    'driver-terms-v2',
    now(),
    now()
  );

insert into public.vehicles (driver_id, type, make, approved)
values ('c1810000-0000-4000-8000-000000000002', 'pickup', 'Ford', true);

select pg_temp.as_user('c1810000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.create_customer_request(
    'c1810000-0000-4000-8000-000000000021',
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
      'customer_name', 'Quote Customer',
      'customer_phone', '+14045550181',
      'already_paid', true,
      'seller_holding', false,
      'wants_item_check', true
    )
  )$$,
  'a customer can post a quote request'
);
reset role;

select pg_temp.as_user('c1810000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'c1810000-0000-4000-8000-000000000021'),
  1,
  'a driver sees a new quote immediately'
);
select lives_ok(
  $$select public.submit_offer('c1810000-0000-4000-8000-000000000021', 'offer', 5000, '')$$,
  'a driver can send an offer on a new quote'
);
reset role;

select pg_temp.as_user('c1810000-0000-4000-8000-000000000003');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'c1810000-0000-4000-8000-000000000021'),
  0,
  'a test driver does not see a real quote'
);
reset role;

select * from finish();
rollback;
