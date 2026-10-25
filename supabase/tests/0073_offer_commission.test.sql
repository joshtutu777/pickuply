-- Commission comes out of the customer offer. Older stored cents stay put.

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

select is((public.price_breakdown('forward', 5000)->>'driver_earnings_cents')::int, 4250, 'a $50 offer pays the driver $42.50');
select is((public.price_breakdown('forward', 5000)->>'platform_fee_cents')::int, 750, 'a $50 offer keeps $7.50');
select is((public.price_breakdown('forward', 10000)->>'driver_earnings_cents')::int, 8500, 'a $100 offer pays the driver $85');
select is((public.price_breakdown('forward', 20000)->>'driver_earnings_cents')::int, 17000, 'a $200 offer pays the driver $170');
select is((public.price_breakdown('forward', 5001)->>'driver_earnings_cents')::int, 4251, 'an odd cent rounds the driver share half up');
select is(
  (public.price_breakdown('forward', 5000)->>'customer_total_cents')::int,
  5000 + (public.price_breakdown('forward', 5000)->>'service_fee_cents')::int,
  'the customer pays the offer plus card processing only'
);
select ok(
  (public.price_breakdown('forward', 5000)->>'service_fee_cents')::int > 0
    and (public.price_breakdown('forward', 5000)->>'driver_earnings_cents')::int
      + (public.price_breakdown('forward', 5000)->>'platform_fee_cents')::int = 5000,
  'processing is added for the customer and the commission stays inside the offer'
);

select pg_temp.make_user('c1730000-0000-4000-8000-000000000001', 'fee-customer@pickuply.test');
select pg_temp.make_user('c1730000-0000-4000-8000-000000000002', 'fee-driver@pickuply.test');
select pg_temp.make_user('c1730000-0000-4000-8000-000000000003', 'fee-test-driver@pickuply.test');
select pg_temp.clear_auth();
update public.profiles set full_name = 'Fee Customer' where id = 'c1730000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'Fee Driver' where id = 'c1730000-0000-4000-8000-000000000002';
update public.profiles set role = 'driver', full_name = 'Fee Test', is_test = true where id = 'c1730000-0000-4000-8000-000000000003';

insert into public.drivers (
  profile_id, status, home_city, home_zip, license_url, license_expires, terms_version, terms_accepted_at, agreement_signed_at, is_online
) values
  ('c1730000-0000-4000-8000-000000000002', 'active', 'Austell', '30106', 'c1730000-0000-4000-8000-000000000002/license.jpg', current_date + 30, 'driver-terms-v1', now(), now(), true),
  ('c1730000-0000-4000-8000-000000000003', 'active', 'Austell', '30106', 'c1730000-0000-4000-8000-000000000003/license.jpg', current_date + 30, 'driver-terms-v1', now(), now(), true);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents
) values (
  'c1730000-0000-4000-8000-000000000010',
  'c1730000-0000-4000-8000-000000000001',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'old priced job', 1, 'medium', 0, 0, false, false, 'asap', 'quote',
  7240, 6000, 1000, 240
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method
) values (
  'c1730000-0000-4000-8000-000000000011',
  'c1730000-0000-4000-8000-000000000001',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'new offer job', 1, 'medium', 0, 0, false, false, 'asap', 'quote'
);

select is(
  (select driver_pay_cents from public.jobs where id = 'c1730000-0000-4000-8000-000000000010'),
  6000,
  'an already priced job keeps its original driver earnings'
);

select pg_temp.as_user('c1730000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.submit_offer('c1730000-0000-4000-8000-000000000011', 'offer', 5000, '')$$,
  'a driver can submit a $50 customer offer'
);
select is(
  (select driver_amount_cents || '|' || platform_fee_cents || '|' || commission_bps
   from public.job_offers
   where job_id = 'c1730000-0000-4000-8000-000000000011' and status = 'active'),
  '4250|750|1500',
  'the submitted offer stores 85 percent, 15 percent, and the rate'
);

select pg_temp.clear_auth();
update public.job_offers
set status = 'withdrawn'
where job_id = 'c1730000-0000-4000-8000-000000000011' and status = 'active';
select pg_temp.as_user('c1730000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.submit_offer('c1730000-0000-4000-8000-000000000011', 'offer', 10000, '')$$,
  'the driver can replace the offer with $100'
);
select is(
  (select driver_amount_cents from public.job_offers
   where job_id = 'c1730000-0000-4000-8000-000000000011' and status = 'active'),
  8500,
  'the replacement offer pays the driver $85'
);

select pg_temp.clear_auth();
update public.platform_settings set platform_bps = 2000 where id = 1;
select is(
  (select commission_bps from public.job_offers
   where job_id = 'c1730000-0000-4000-8000-000000000011' and status = 'active'),
  1500,
  'a later rate change does not rewrite the stored offer'
);
select is(
  (public.price_breakdown('forward', 5000)->>'driver_earnings_cents')::int,
  4000,
  'a new calculation uses the updated rate'
);

select pg_temp.as_user('c1730000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.submit_offer('c1730000-0000-4000-8000-000000000011', 'offer', 5000, '')$$,
  'this driver cannot offer on this job',
  'a test driver cannot offer on a real job'
);

select pg_temp.as_user('c1730000-0000-4000-8000-000000000001');
select lives_ok(
  $$select public.choose_offer((
    select id from public.job_offers
    where job_id = 'c1730000-0000-4000-8000-000000000011' and status = 'active'
  ))$$,
  'the customer can choose the stored offer'
);
select is(
  (select body from public.notifications
   where job_id = 'c1730000-0000-4000-8000-000000000011' and kind = 'assigned'),
  'The customer chose you for a job in Austell 30168. Your earnings are $85.',
  'the assignment notice includes the stored driver earnings'
);

select pg_temp.as_user('c1730000-0000-4000-8000-000000000001');
select throws_ok(
  $$insert into public.jobs (
    id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
    item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
  ) values (
    'c1730000-0000-4000-8000-000000000012',
    'c1730000-0000-4000-8000-000000000001',
    'junk', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell 30168', 'low junk price', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 4000
  )$$,
  'offer amount is below the minimum',
  'a junk price under $50 is rejected'
);

select throws_ok(
  $$insert into public.jobs (
    id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
    item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
    offer_cents, budget_min_cents, budget_max_cents
  ) values (
    'c1730000-0000-4000-8000-000000000013',
    'c1730000-0000-4000-8000-000000000001',
    'junk', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell 30168', 'low junk range', 1, 'medium', 0, 0, false, false, 'asap', 'range',
    null, 4000, 8000
  )$$,
  'offer amount is below the minimum',
  'a junk budget under $50 is rejected'
);

select * from finish();
rollback;
