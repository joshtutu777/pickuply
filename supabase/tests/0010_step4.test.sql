-- Local Supabase only. Pricing, authorization, and assignment checks for Step 4.

begin;

select plan(33);

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

select pg_temp.make_user('c1111111-1111-4111-8111-111111111111', 'step4-customer@pickuply.test');
select pg_temp.make_user('c3333333-3333-4333-8333-333333333333', 'step4-admin@pickuply.test');
select pg_temp.make_user('c4444444-4444-4444-8444-444444444444', 'step4-driver@pickuply.test');
select pg_temp.make_user('c5555555-5555-4555-8555-555555555555', 'step4-driver2@pickuply.test');
select pg_temp.make_user('c9999999-9999-4999-8999-999999999999', 'step4-paused@pickuply.test');

update public.profiles set role = 'admin', full_name = 'Step Admin' where id = 'c3333333-3333-4333-8333-333333333333';
update public.profiles set role = 'driver', full_name = 'Ada Driver' where id = 'c4444444-4444-4444-8444-444444444444';
update public.profiles set role = 'driver', full_name = 'Bea Driver' where id = 'c5555555-5555-4555-8555-555555555555';
update public.profiles set role = 'driver', full_name = 'Paused Driver' where id = 'c9999999-9999-4999-8999-999999999999';
update public.profiles set full_name = 'Casey Customer' where id = 'c1111111-1111-4111-8111-111111111111';

insert into public.drivers (
  profile_id, status, zone_id, service_level, services, max_distance_miles, is_online,
  license_expires, insurance_expires, insurance_url
)
select id,
  case id
    when 'c9999999-9999-4999-8999-999999999999' then 'paused'::public.driver_status
    else 'active'::public.driver_status
  end,
  (select id from public.zones where slug = 'west_metro'),
  'full',
  array['delivery']::public.job_service[],
  25,
  id <> 'c9999999-9999-4999-8999-999999999999',
  current_date + 30,
  current_date + 30,
  id::text || '/insurance.jpg'
from public.profiles
where id in (
  'c4444444-4444-4444-8444-444444444444',
  'c5555555-5555-4555-8555-555555555555',
  'c9999999-9999-4999-8999-999999999999'
);

insert into public.vehicles (driver_id, type, make, approved)
select profile_id, 'pickup', 'Ford', true
from public.drivers
where profile_id in (
  'c4444444-4444-4444-8444-444444444444',
  'c5555555-5555-4555-8555-555555555555'
);

select set_config('pickuply.quote_accepted', 'yes', true);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date,
  pricing_method, offer_cents, service_level, required_vehicle,
  price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents, quote_expires_at
) values
  (
    'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'c1111111-1111-4111-8111-111111111111',
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell 30106', 'private description', 1, 'medium', 10000, 0, false, true, 'asap',
    'quote', null, 'full', 'pickup', 7240, 6000, 1000, 240, now() + interval '2 hours'
  ),
  (
    'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'c1111111-1111-4111-8111-111111111111',
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell 30106', 'private description', 1, 'medium', 10000, 0, false, true, 'asap',
    'fixed', 6000, 'full', 'pickup', null, null, null, null, null
  ),
  (
    'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'c1111111-1111-4111-8111-111111111111',
    'delivery', 'requested', (select id from public.zones where slug = 'west_metro'),
    'Austell 30106', 'private description', 1, 'medium', 10000, 0, false, true, 'asap',
    'fixed', 6000, null, null, null, null, null, null, null
  );

insert into public.job_private (job_id, pickup_address, customer_name, customer_phone)
values (
  'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  '10 Hidden Street',
  'Casey Customer',
  '+15555550100'
);

insert into storage.objects (bucket_id, name, owner_id) values
  ('job-photos', 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/request/a.jpg', 'c1111111-1111-4111-8111-111111111111'),
  ('job-photos', 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/pickup/b.jpg', 'c4444444-4444-4444-8444-444444444444');

select is(
  (public.price_breakdown('accept', 3500)->>'driver_earnings_cents')::int,
  2975,
  'a posted $35 offer pays the driver 85 percent'
);
select is(
  (public.price_breakdown('accept', 3500)->>'platform_fee_cents')::int,
  525,
  'a posted $35 offer keeps a 15 percent commission'
);
select is(
  (public.price_breakdown('accept', 3500)->>'service_fee_cents')::int,
  135,
  'a posted $35 offer adds card processing on top'
);
select is(
  (public.price_breakdown('accept', 15000)->>'driver_earnings_cents')::int,
  12750,
  'a posted $150 offer pays the driver $127.50'
);
select is(
  (public.price_breakdown('accept', 15000)->>'platform_fee_cents')::int,
  2250,
  'a posted $150 offer keeps $22.50'
);
select is(
  (public.price_breakdown('accept', 15000)->>'service_fee_cents')::int,
  479,
  'a posted $150 offer adds card processing on top'
);
select is(
  (public.price_breakdown('forward', 6000)->>'customer_total_cents')::int,
  6210,
  'a $60 customer offer totals $62.10 with card processing'
);
select is(
  (public.price_breakdown('forward', 6000)->>'driver_earnings_cents')::int,
  5100,
  'a $60 customer offer pays the driver $51'
);
select is(
  (public.price_breakdown('forward', 12000)->>'customer_total_cents')::int,
  12389,
  'a $120 customer offer adds card processing on top'
);

select pg_temp.as_user('c1111111-1111-4111-8111-111111111111');
set local role authenticated;
select throws_ok(
  $$select public.review_driver('c1111111-1111-4111-8111-111111111111', 'approve_active', 'no')$$,
  'only an admin can review drivers',
  'a customer cannot approve their own driver account'
);
select throws_ok(
  $$select public.review_request('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'publish', '{}'::jsonb)$$,
  'only an admin can review requests',
  'a customer cannot publish a request'
);
select throws_ok(
  $$select public.update_platform_settings(1000, 1000, 290, 30, 30)$$,
  'only an admin can change settings',
  'a customer cannot change fee settings'
);
select throws_ok(
  $$update public.profiles set role = 'driver' where id = 'c1111111-1111-4111-8111-111111111111'$$,
  'users cannot change their own role',
  'a user cannot change their own role'
);
reset role;

select pg_temp.as_user('c9999999-9999-4999-8999-999999999999');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id::text like 'caaaaaaa-aaaa-4aaa-8aaa-%'),
  2,
  'a paused driver still sees open jobs'
);
reset role;

select pg_temp.as_user('c4444444-4444-4444-8444-444444444444');
set local role authenticated;
select is(
  (select count(*)::int from public.driver_job_feed() where id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  0,
  'a requested job is not in the feed'
);
select is(
  (select count(*)::int from public.job_private where job_id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  0,
  'an unassigned driver cannot read the private address'
);
select is(
  (select count(*)::int from storage.objects where name like 'caaaaaaa-aaaa-4aaa-8aaa-%/request/%'),
  1,
  'an eligible driver can read the request photo'
);
select is(
  (select count(*)::int from storage.objects where name like '%/pickup/%'),
  0,
  'an eligible driver cannot read a pickup photo'
);
select throws_ok(
  $$select description from public.driver_job_feed()$$,
  '42703',
  null,
  'the feed has no description column'
);
select lives_ok(
  $$select public.submit_offer('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'offer', 6000, 'stairs')$$,
  'a driver can offer on an open Get Offers job'
);

reset role;
select pg_temp.clear_auth();
update public.drivers set is_online = false where profile_id = 'c4444444-4444-4444-8444-444444444444';
select pg_temp.as_user('c4444444-4444-4444-8444-444444444444');
set local role authenticated;
select throws_ok(
  $$select public.claim_job('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$$,
  'go online before claiming a job',
  'claiming requires Online'
);
reset role;
select pg_temp.clear_auth();
update public.drivers set is_online = true where profile_id = 'c4444444-4444-4444-8444-444444444444';
select pg_temp.as_user('c4444444-4444-4444-8444-444444444444');
set local role authenticated;
select lives_ok(
  $$select public.claim_job('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$$,
  'the first online driver claims the quote job'
);
select throws_ok(
  $$select public.claim_job('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$$,
  'job already taken',
  'a second claim is told the job is already taken'
);
reset role;
select pg_temp.clear_auth();

select is(
  (select payment_status from public.jobs where id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'awaiting_payment',
  'a claim waits for payment and does not charge'
);
select throws_ok(
  $$update public.jobs set status = 'en_route' where id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,
  'payment must be authorized before work starts',
  'work cannot start before payment is authorized'
);

select pg_temp.as_user('c4444444-4444-4444-8444-444444444444');
set local role authenticated;
select lives_ok(
  $$select public.submit_offer('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'accept', null, null)$$,
  'the driver can accept the posted fixed price'
);
reset role;
select pg_temp.as_user('c5555555-5555-4555-8555-555555555555');
set local role authenticated;
select lives_ok(
  $$select public.submit_offer('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'counter', 8000, 'stairs')$$,
  'a second driver can counter'
);
reset role;
select pg_temp.as_user('c1111111-1111-4111-8111-111111111111');
set local role authenticated;
select lives_ok(
  $$select public.choose_offer((
    select id from public.job_offers
    where job_id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' and driver_id = 'c4444444-4444-4444-8444-444444444444'
  ))$$,
  'the customer chooses one offer'
);
select throws_ok(
  $$select public.choose_offer((
    select id from public.job_offers
    where job_id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' and driver_id = 'c5555555-5555-4555-8555-555555555555'
  ))$$,
  'that offer is no longer available',
  'a second choice does not assign another driver'
);
reset role;
select pg_temp.clear_auth();

select is(
  (select assigned_driver_id from public.jobs where id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  'c4444444-4444-4444-8444-444444444444'::uuid,
  'choosing an offer assigns exactly one driver'
);
select is(
  (select offer_cents from public.jobs where id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  6000,
  'choosing an offer keeps the customer original price'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  price_cents, driver_pay_cents, service_level, required_vehicle, quote_expires_at
) values (
  'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  'c1111111-1111-4111-8111-111111111111',
  'delivery', 'quoted', (select id from public.zones where slug = 'west_metro'),
  'Austell 30106', 'expired quote', 1, 'medium', 0, 0, false, true, 'asap',
  'quote', 7240, 6000, 'full', 'pickup', now() - interval '1 hour'
);
select pg_temp.as_user('c1111111-1111-4111-8111-111111111111');
set local role authenticated;
select throws_ok(
  $$select public.accept_admin_quote('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4')$$,
  'this quote has expired',
  'an expired quote cannot be accepted'
);
reset role;
select pg_temp.clear_auth();
select is(
  (select status::text from public.jobs where id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'),
  'quoted',
  'rejecting an expired quote leaves it unpublished'
);

select * from finish();
rollback;
