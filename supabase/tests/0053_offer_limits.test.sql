-- Five active offers per job, no 2x cap, and admin-editable minimum offer amounts.

begin;

set local search_path to public, extensions;

select plan(37);

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

create or replace function pg_temp.as_db()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

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
  perform set_config('role', 'authenticated', true);
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

update public.platform_settings set waves_enabled = false;

select pg_temp.make_user('e5300000-0000-4000-8000-000000000001', 'offer-d1@pickuply.test');
select pg_temp.make_user('e5300000-0000-4000-8000-000000000002', 'offer-d2@pickuply.test');
select pg_temp.make_user('e5300000-0000-4000-8000-000000000003', 'offer-d3@pickuply.test');
select pg_temp.make_user('e5300000-0000-4000-8000-000000000004', 'offer-d4@pickuply.test');
select pg_temp.make_user('e5300000-0000-4000-8000-000000000005', 'offer-d5@pickuply.test');
select pg_temp.make_user('e5300000-0000-4000-8000-000000000006', 'offer-d6@pickuply.test');
select pg_temp.make_user('e5300000-0000-4000-8000-000000000007', 'offer-customer@pickuply.test');
select pg_temp.make_user('e5300000-0000-4000-8000-000000000008', 'offer-admin@pickuply.test');

update public.profiles set role = 'driver' where id in (
  'e5300000-0000-4000-8000-000000000001',
  'e5300000-0000-4000-8000-000000000002',
  'e5300000-0000-4000-8000-000000000003',
  'e5300000-0000-4000-8000-000000000004',
  'e5300000-0000-4000-8000-000000000005',
  'e5300000-0000-4000-8000-000000000006'
);
update public.profiles set role = 'admin' where id = 'e5300000-0000-4000-8000-000000000008';

insert into public.drivers (
  profile_id, status, zone_id, service_level, services, is_online
)
select id, 'active', (select id from public.zones where slug = 'west_metro'), 'full',
  array['delivery', 'junk', 'free_item', 'construction']::public.job_service[], true
from public.profiles
where id in (
  'e5300000-0000-4000-8000-000000000001',
  'e5300000-0000-4000-8000-000000000002',
  'e5300000-0000-4000-8000-000000000003',
  'e5300000-0000-4000-8000-000000000004',
  'e5300000-0000-4000-8000-000000000005',
  'e5300000-0000-4000-8000-000000000006'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
  item_value_cents, stairs_pickup, stairs_dropoff, elevator, help_loading, preferred_date,
  pricing_method, offer_cents, service_level, required_vehicle
)
select
  ('e5300000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  'e5300000-0000-4000-8000-000000000007',
  service, 'open', (select id from public.zones where slug = 'west_metro'),
  'Albany, 31721', 'Albany, 31721', 'Offer desk', 1, 'medium',
  0, 0, 0, false, false, 'asap', pricing, posted, 'light', null
from (values
  (10, 'delivery'::public.job_service, 'quote'::public.pricing_method, null::integer),
  (11, 'delivery', 'quote', null),
  (12, 'delivery', 'quote', null),
  (13, 'delivery', 'quote', null),
  (14, 'delivery', 'quote', null),
  (15, 'delivery', 'quote', null),
  (16, 'junk', 'quote', null),
  (17, 'construction', 'quote', null),
  (18, 'delivery', 'fixed', 4000),
  (19, 'free_item', 'quote', null)
) as jobs(n, service, pricing, posted);

select is(
  (select delivery_offer_min_cents from public.platform_settings where id = 1),
  3500,
  'pickup and delivery offers start at $35'
);
select is(
  (select junk_offer_min_cents from public.platform_settings where id = 1),
  5000,
  'junk offers start at $50'
);
select is(
  (select store_offer_min_cents from public.platform_settings where id = 1),
  3500,
  'store delivery offers start at $35'
);
select is(
  (select free_item_offer_min_cents from public.platform_settings where id = 1),
  3500,
  'free-item offers start at $35'
);

select pg_temp.as_user('e5300000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.update_offer_minimums(3500, 5000, 3500, 3500)$$,
  'only an admin can change settings',
  'a driver cannot change offer minimums'
);

select pg_temp.as_user('e5300000-0000-4000-8000-000000000008');
select lives_ok(
  $$select public.update_offer_minimums(3500, 6000, 3500, 3500)$$,
  'an admin can raise the junk minimum'
);
select is(
  (select junk_offer_min_cents from public.platform_settings where id = 1),
  6000,
  'the junk minimum is saved'
);
select lives_ok(
  $$select public.update_offer_minimums(3500, 5000, 3500, 3500)$$,
  'an admin can restore the junk minimum'
);

select pg_temp.as_user('e5300000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000010', 'offer', 3400, '')$$,
  'offer amount is below the minimum',
  'a $34 pickup offer is rejected'
);
select lives_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000010', 'offer', 3500, '')$$,
  'a $35 pickup offer is accepted'
);
select is(
  (select assigned_driver_id from public.jobs where id = 'e5300000-0000-4000-8000-000000000010'),
  null,
  'submitting an offer does not assign the driver'
);
select ok(
  (
    select customer_total_cents > driver_amount_cents and platform_fee_cents > 0
    from public.job_offers
    where job_id = 'e5300000-0000-4000-8000-000000000010'
      and driver_id = 'e5300000-0000-4000-8000-000000000001'
  ),
  'the server still calculates the customer total'
);
select throws_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000016', 'offer', 4900, '')$$,
  'offer amount is below the minimum',
  'a $49 junk offer is rejected'
);
select lives_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000016', 'offer', 5000, '')$$,
  'a $50 junk offer is accepted'
);
select throws_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000017', 'offer', 3400, '')$$,
  'offer amount is below the minimum',
  'a $34 store delivery offer is rejected'
);
select lives_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000017', 'offer', 3500, '')$$,
  'a $35 store delivery offer is accepted'
);
select throws_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000019', 'offer', 3400, '')$$,
  'offer amount is below the minimum',
  'a $34 free-item offer is rejected'
);
select lives_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000019', 'offer', 3500, '')$$,
  'a $35 free-item offer is accepted'
);
select throws_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000010', 'offer', 4000, '')$$,
  'withdraw your current offer before sending another',
  'a driver cannot hold two active offers on one job'
);
select lives_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000011', 'offer', 3500, '')$$,
  'the same driver can offer on a second job'
);
select lives_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000012', 'offer', 3500, '')$$,
  'the same driver can offer on a third job'
);
select lives_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000013', 'offer', 3500, '')$$,
  'the same driver can offer on a fourth job'
);
select lives_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000014', 'offer', 3500, '')$$,
  'the same driver can offer on a fifth job'
);
select lives_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000015', 'offer', 3500, '')$$,
  'the same driver can offer on a sixth job'
);
select pg_temp.as_db();
select is(
  (
    select count(*)::int from public.job_offers
    where driver_id = 'e5300000-0000-4000-8000-000000000001' and status = 'active'
  ),
  9,
  'active offers are not capped at five per driver'
);

select pg_temp.as_user('e5300000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000010', 'offer', 3600, '')$$,
  'a second driver can offer on the same job'
);
select pg_temp.as_user('e5300000-0000-4000-8000-000000000003');
select lives_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000010', 'offer', 3700, '')$$,
  'a third driver can offer on the same job'
);
select pg_temp.as_user('e5300000-0000-4000-8000-000000000004');
select lives_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000010', 'offer', 3800, '')$$,
  'a fourth driver can offer on the same job'
);
select pg_temp.as_user('e5300000-0000-4000-8000-000000000005');
select lives_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000010', 'offer', 3900, '')$$,
  'the fifth active offer on a job is accepted'
);
select pg_temp.as_db();
select is(
  (
    select count(*)::int from public.job_offers
    where job_id = 'e5300000-0000-4000-8000-000000000010' and status = 'active'
  ),
  5,
  'the job now has five active offers'
);
select pg_temp.as_user('e5300000-0000-4000-8000-000000000006');
select throws_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000010', 'offer', 4000, '')$$,
  'this job already has five active offers',
  'a sixth offer on the same job is rejected'
);
select pg_temp.as_db();
select is(
  (
    select count(*)::int from public.job_offers
    where job_id = 'e5300000-0000-4000-8000-000000000010' and status = 'active'
  ),
  5,
  'the rejected offer does not take a slot'
);
select pg_temp.as_user('e5300000-0000-4000-8000-000000000006');
select lives_ok(
  $$select public.submit_offer('e5300000-0000-4000-8000-000000000018', 'offer', 100000, '')$$,
  'an offer far above the posted price is allowed'
);
select is(
  (select assigned_driver_id from public.jobs where id = 'e5300000-0000-4000-8000-000000000018'),
  null,
  'a large offer still does not assign the driver'
);
select ok(
  (
    select customer_total_cents > 8000
    from public.job_offers
    where job_id = 'e5300000-0000-4000-8000-000000000018'
      and driver_id = 'e5300000-0000-4000-8000-000000000006'
  ),
  'the old twice-the-price cap is gone'
);
select is(
  position('twice the customer price' in pg_get_functiondef('public.guard_job_offers()'::regprocedure)),
  0,
  'the offer guard no longer mentions a twice-price cap'
);
select is(
  position('five active offers at a time' in pg_get_functiondef('public.guard_active_offer_cap()'::regprocedure)),
  0,
  'the offer cap is no longer counted per driver'
);

select * from finish();
rollback;
