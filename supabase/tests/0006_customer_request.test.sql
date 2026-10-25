-- Local Supabase only. Do not run this against the hosted project.
-- supabase test db applies migrations, runs this file, and rolls the test transaction back.

begin;

select plan(51);

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
    '00000000-0000-0000-0000-000000000000',
    uid,
    'authenticated',
    'authenticated',
    email,
    'test-hash',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    uid::text,
    '',
    uid::text || '-email',
    uid::text || '-recovery'
  );
end;
$$;

create or replace function pg_temp.base_payload(service text, pricing text)
returns jsonb
language plpgsql
as $$
declare
  body jsonb := jsonb_build_object(
    'service', service,
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
    'pricing_method', pricing,
    'source', 'nextdoor',
    'zone_slug', 'west_metro',
    'pickup_area', 'Austell, 30106',
    'pickup_address', '10 Secret Street',
    'customer_name', 'Ada Lovelace',
    'customer_phone', '+14045551212',
    'customer_email', 'ada@example.com',
    'access_notes', null
  );
begin
  if service = 'junk' then
    body := body || jsonb_build_object(
      'dropoff_area', null,
      'dropoff_address', null,
      'stairs_dropoff', null,
      'already_paid', null,
      'seller_holding', null,
      'wants_item_check', null,
      'junk_load_size', 'quarter',
      'junk_materials', 'Wood furniture',
      'junk_special_items', jsonb_build_object('mattress', false, 'tires', false, 'appliances', false),
      'store_name', null,
      'store_order_number', null
    );
  else
    body := body || jsonb_build_object(
      'dropoff_area', 'Smyrna, 30080',
      'dropoff_address', '20 Hidden Avenue',
      'stairs_dropoff', 0,
      'already_paid', case when service = 'delivery' then true else null end,
      'seller_holding', case when service = 'delivery' then false else null end,
      'wants_item_check', case when service = 'delivery' then true else null end,
      'junk_load_size', null,
      'junk_materials', null,
      'junk_special_items', null,
      'store_name', case when service = 'construction' then 'Home Depot' else null end,
      'store_order_number', null
    );
  end if;

  if pricing = 'fixed' then
    body := body || jsonb_build_object('offer_cents', 4000, 'budget_min_cents', null, 'budget_max_cents', null);
  elsif pricing = 'range' then
    body := body || jsonb_build_object('offer_cents', null, 'budget_min_cents', 4000, 'budget_max_cents', 8000);
  else
    body := body || jsonb_build_object('offer_cents', null, 'budget_min_cents', null, 'budget_max_cents', null);
  end if;

  return body;
end;
$$;

select pg_temp.make_user('a1111111-1111-4111-8111-111111111111', 'customer-a@pickuply.test');
select pg_temp.make_user('b2222222-2222-4222-8222-222222222222', 'customer-b@pickuply.test');
select pg_temp.make_user('c3333333-3333-4333-8333-333333333333', 'customer-admin@pickuply.test');
select pg_temp.make_user('d4444444-4444-4444-8444-444444444444', 'customer-driver@pickuply.test');

update public.profiles set role = 'admin' where id = 'c3333333-3333-4333-8333-333333333333';
update public.profiles set role = 'driver' where id = 'd4444444-4444-4444-8444-444444444444';

insert into public.drivers (
  profile_id, status, zone_id, service_level, services, max_distance_miles, is_online, last_lat, last_lng
)
select
  'd4444444-4444-4444-8444-444444444444',
  'active',
  id,
  'full',
  array['delivery', 'junk', 'free_item', 'construction']::public.job_service[],
  25,
  true,
  33.95,
  -84.55
from public.zones
where slug = 'west_metro';

insert into public.vehicles (driver_id, type, approved)
values ('d4444444-4444-4444-8444-444444444444', 'pickup', true);

select ok(
  not (
    select prosecdef from pg_proc
    where proname = 'create_customer_request'
      and pg_get_function_identity_arguments(oid) = 'request_id uuid, payload jsonb'
  ),
  'create_customer_request runs as the caller'
);
select ok(
  not (
    select prosecdef from pg_proc
    where proname = 'attach_request_photo'
      and pg_get_function_identity_arguments(oid) = 'target_job_id uuid, target_path text'
  ),
  'attach_request_photo runs as the caller'
);
select ok(
  not has_function_privilege('anon', 'public.create_customer_request(uuid, jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.create_customer_request(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.create_customer_request(uuid, jsonb)', 'execute'),
  'only a signed-in user can execute create_customer_request'
);
select ok(
  not has_function_privilege('anon', 'public.attach_request_photo(uuid, text)', 'execute')
  and not has_function_privilege('service_role', 'public.attach_request_photo(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.attach_request_photo(uuid, text)', 'execute'),
  'only a signed-in user can record a request photo'
);
select ok(
  (
    select prosecdef from pg_proc
    where proname = 'request_id_visibility'
      and pg_get_function_identity_arguments(oid) = 'target uuid'
  )
  and not has_function_privilege('anon', 'public.request_id_visibility(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.request_id_visibility(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.request_id_visibility(uuid)', 'execute'),
  'the ownership check reveals only absent, own, or other'
);

set local role anon;
select throws_ok(
  $$select public.create_customer_request(
    'e1111111-1111-4111-8111-111111111111',
    pg_temp.base_payload('delivery', 'quote')
  )$$,
  '42501',
  null,
  'anon cannot create a request'
);
reset role;

set local role service_role;
select throws_ok(
  $$select public.create_customer_request(
    'e1111111-1111-4111-8111-111111111111',
    pg_temp.base_payload('delivery', 'quote')
  )$$,
  '42501',
  null,
  'the service role cannot create a customer request'
);
reset role;

select pg_temp.clear_auth();
set local role authenticated;
select throws_ok(
  $$select public.create_customer_request(
    'e1111111-1111-4111-8111-111111111111',
    pg_temp.base_payload('delivery', 'quote')
  )$$,
  'sign in required',
  'a session without a user cannot create a request'
);

select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');

select is(
  public.create_customer_request(
    'e1111111-1111-4111-8111-111111111111',
    pg_temp.base_payload('delivery', 'quote')
  ),
  'e1111111-1111-4111-8111-111111111111'::uuid,
  'a quote delivery returns the request id'
);
select is(
  public.create_customer_request(
    'e2222222-2222-4222-8222-222222222222',
    pg_temp.base_payload('delivery', 'fixed')
  ),
  'e2222222-2222-4222-8222-222222222222'::uuid,
  'a named price returns the request id'
);
select is(
  public.create_customer_request(
    'e3333333-3333-4333-8333-333333333333',
    pg_temp.base_payload('delivery', 'range')
  ),
  'e3333333-3333-4333-8333-333333333333'::uuid,
  'a budget range returns the request id'
);
select is(
  public.create_customer_request(
    'e4444444-4444-4444-8444-444444444444',
    pg_temp.base_payload('junk', 'quote')
  ),
  'e4444444-4444-4444-8444-444444444444'::uuid,
  'junk removal returns the request id'
);
select is(
  public.create_customer_request(
    'e5555555-5555-4555-8555-555555555555',
    pg_temp.base_payload('free_item', 'quote')
  ),
  'e5555555-5555-4555-8555-555555555555'::uuid,
  'a free-item pickup returns the request id'
);
select is(
  public.create_customer_request(
    'e6666666-6666-4666-8666-666666666666',
    pg_temp.base_payload('construction', 'quote')
  ),
  'e6666666-6666-4666-8666-666666666666'::uuid,
  'a construction delivery returns the request id'
);
select is(
  public.create_customer_request(
    'e7777777-7777-4777-8777-777777777777',
    pg_temp.base_payload('delivery', 'quote') || '{"item_value_cents": 100001}'::jsonb
  ),
  'e7777777-7777-4777-8777-777777777777'::uuid,
  'a high-value request is saved'
);

select ok(
  (select status = 'open' and customer_id = 'a1111111-1111-4111-8111-111111111111'
    and price_cents is null and driver_pay_cents is null and platform_fee_cents is null
    and dump_fee_cents is null and quote_expires_at is null and assigned_driver_id is null
    and offer_cents is null
    from public.jobs where id = 'e1111111-1111-4111-8111-111111111111'),
  'a quote opens with no price, fee, or driver'
);
select is(
  (select offer_cents from public.jobs where id = 'e2222222-2222-4222-8222-222222222222'),
  4000,
  'a named price stores the customer amount'
);
select ok(
  (select budget_min_cents is null and budget_max_cents is null and price_cents is null
    from public.jobs where id = 'e2222222-2222-4222-8222-222222222222'),
  'a named price has no budget and no booked total'
);
select is(
  (select budget_min_cents from public.jobs where id = 'e3333333-3333-4333-8333-333333333333'),
  4000,
  'a budget stores the minimum'
);
select is(
  (select budget_max_cents from public.jobs where id = 'e3333333-3333-4333-8333-333333333333'),
  8000,
  'a budget stores the maximum'
);
select ok(
  (select offer_cents is null and price_cents is null
    from public.jobs where id = 'e3333333-3333-4333-8333-333333333333'),
  'a budget is not booked and has no single price'
);
select ok(
  (select dropoff_area is null and service = 'junk'
    from public.jobs where id = 'e4444444-4444-4444-8444-444444444444')
  and (select dropoff_address is null from public.job_private where job_id = 'e4444444-4444-4444-8444-444444444444'),
  'junk removal has no drop-off'
);
select is(
  (select store_name from public.jobs where id = 'e6666666-6666-4666-8666-666666666666'),
  'Home Depot',
  'construction keeps the store name'
);
select is(
  (select needs_value_approval from public.jobs where id = 'e7777777-7777-4777-8777-777777777777'),
  true,
  'the database flags a value above $1000'
);
select is(
  (select customer_phone from public.job_private where job_id = 'e1111111-1111-4111-8111-111111111111'),
  '+14045551212',
  'the private phone is stored for the owner'
);
select is(
  (select count(*)::int from public.job_events where job_id = 'e1111111-1111-4111-8111-111111111111'),
  1,
  'creating a request writes one status event'
);

select is(
  public.create_customer_request(
    'e1111111-1111-4111-8111-111111111111',
    pg_temp.base_payload('delivery', 'quote')
  ),
  'e1111111-1111-4111-8111-111111111111'::uuid,
  'the same request returns the original id'
);
select is(
  (select count(*)::int from public.jobs where id = 'e1111111-1111-4111-8111-111111111111'),
  1,
  'a retry does not create a second job'
);
select is(
  (select count(*)::int from public.job_private where job_id = 'e1111111-1111-4111-8111-111111111111'),
  1,
  'a retry does not create a second private row'
);
select is(
  (select count(*)::int from public.job_events where job_id = 'e1111111-1111-4111-8111-111111111111'),
  1,
  'a retry does not write another status event'
);
select is(
  (select description from public.jobs where id = 'e1111111-1111-4111-8111-111111111111'),
  'Oak dresser',
  'a matching retry leaves the description unchanged'
);

select throws_ok(
  $$select public.create_customer_request(
    'e1111111-1111-4111-8111-111111111111',
    pg_temp.base_payload('delivery', 'quote') || '{"description": "Changed dresser"}'::jsonb
  )$$,
  'this request was already saved with different details',
  'a different retry is rejected'
);
select is(
  (select description from public.jobs where id = 'e1111111-1111-4111-8111-111111111111'),
  'Oak dresser',
  'a rejected retry does not change the saved job'
);

select pg_temp.as_user('b2222222-2222-4222-8222-222222222222');
select throws_ok(
  $$select public.create_customer_request(
    'e1111111-1111-4111-8111-111111111111',
    pg_temp.base_payload('delivery', 'quote')
  )$$,
  'request not found',
  'another customer cannot reuse the request id'
);
select throws_ok(
  $$select public.attach_request_photo(
    'e1111111-1111-4111-8111-111111111111',
    'e1111111-1111-4111-8111-111111111111/request/f1111111-1111-4111-8111-111111111111.jpg'
  )$$,
  'request not found',
  'another customer cannot attach a photo'
);

select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
select ok(
  (select customer_id = 'a1111111-1111-4111-8111-111111111111'::uuid
    and description = 'Oak dresser'
    from public.jobs where id = 'e1111111-1111-4111-8111-111111111111'),
  'the original customer still owns the unchanged request'
);
select throws_ok(
  $$select public.create_customer_request(
    'e8888888-8888-4888-8888-888888888888',
    pg_temp.base_payload('delivery', 'fixed') || '{"offer_cents": 3499}'::jsonb
  )$$,
  'a named price must be at least $35',
  'a named price under $35 is rejected'
);
select throws_ok(
  $$select public.create_customer_request(
    'e8888888-8888-4888-8888-888888888888',
    pg_temp.base_payload('delivery', 'quote') || '{"offer_cents": 4000}'::jsonb
  )$$,
  'a quote request has no customer price',
  'a quote cannot include a customer price'
);
select throws_ok(
  $$select public.create_customer_request(
    'e8888888-8888-4888-8888-888888888888',
    pg_temp.base_payload('delivery', 'quote') || '{"price_cents": 5000}'::jsonb
  )$$,
  'unexpected field',
  'a customer cannot send a platform price'
);
select throws_ok(
  $$select public.create_customer_request(
    'e8888888-8888-4888-8888-888888888888',
    pg_temp.base_payload('junk', 'quote') || '{"dropoff_address": "1 Street"}'::jsonb
  )$$,
  'junk removal has no drop-off',
  'junk removal rejects a drop-off'
);
select throws_ok(
  $$select public.create_customer_request(
    'e8888888-8888-4888-8888-888888888888',
    pg_temp.base_payload('delivery', 'quote') || '{"dropoff_address": null, "dropoff_area": null}'::jsonb
  )$$,
  'drop-off area and address are required',
  'delivery requires a drop-off'
);
select is(
  (select count(*)::int from public.jobs where id = 'e8888888-8888-4888-8888-888888888888'),
  0,
  'rejected requests do not leave a job'
);

select is(
  public.attach_request_photo(
    'e1111111-1111-4111-8111-111111111111',
    'e1111111-1111-4111-8111-111111111111/request/f1111111-1111-4111-8111-111111111111.jpg'
  ),
  public.attach_request_photo(
    'e1111111-1111-4111-8111-111111111111',
    'e1111111-1111-4111-8111-111111111111/request/f1111111-1111-4111-8111-111111111111.jpg'
  ),
  'attaching the same photo twice returns one id'
);
select is(
  (select count(*)::int from public.job_photos
    where storage_path = 'e1111111-1111-4111-8111-111111111111/request/f1111111-1111-4111-8111-111111111111.jpg'),
  1,
  'a photo retry does not insert a second row'
);
select throws_ok(
  $$select public.attach_request_photo(
    'e1111111-1111-4111-8111-111111111111',
    'not-a-path.jpg'
  )$$,
  'invalid photo path',
  'a photo path must match the request folder'
);
select throws_ok(
  $$select public.attach_request_photo(
    'e1111111-1111-4111-8111-111111111111',
    'e2222222-2222-4222-8222-222222222222/request/f1111111-1111-4111-8111-111111111111.jpg'
  )$$,
  'invalid photo path',
  'a photo path cannot name a different request'
);

select pg_temp.as_user('d4444444-4444-4444-8444-444444444444');
select is(
  (select count(*)::int from public.jobs where id = 'e1111111-1111-4111-8111-111111111111'),
  0,
  'a driver cannot read an unassigned job'
);
select is(
  (select count(*)::int from public.job_private where job_id = 'e1111111-1111-4111-8111-111111111111'),
  0,
  'a driver cannot read the private details'
);
select is(
  (select count(*)::int from public.driver_job_feed()
    where id = 'e1111111-1111-4111-8111-111111111111'),
  1,
  'an open request is in the driver feed'
);

select pg_temp.as_user('c3333333-3333-4333-8333-333333333333');
select is(
  (select count(*)::int from public.jobs where id = 'e1111111-1111-4111-8111-111111111111'),
  1,
  'an admin can read the request'
);
select is(
  (select pickup_area from public.jobs where id = 'e1111111-1111-4111-8111-111111111111'),
  'Austell, 30106',
  'an admin sees the area without this test reading the street from the public row'
);

select * from finish();
rollback;
