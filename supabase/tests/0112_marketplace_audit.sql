-- Local only. Isolated audit personas. The transaction rolls back.
-- Output lines start with AUDIT| so the runner can collect them.

begin;

create temp table audit_results (
  test_id text primary key,
  phase text not null,
  status text not null,
  detail text not null
);

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

create or replace function pg_temp.note(p_test_id text, p_phase text, p_status text, p_detail text)
returns void
language plpgsql
security definer
set search_path = pg_temp, public
as $$
begin
  insert into audit_results (test_id, phase, status, detail)
  values (p_test_id, p_phase, p_status, left(coalesce(p_detail, ''), 400))
  on conflict (test_id) do update
  set status = excluded.status, detail = excluded.detail, phase = excluded.phase;
end;
$$;

create or replace function pg_temp.as_user(uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.expect_error(test_id text, phase text, uid uuid, statement text, fragment text)
returns void
language plpgsql
as $$
declare
  msg text;
begin
  perform pg_temp.as_user(uid);
  begin
    execute statement;
    perform pg_temp.note(test_id, phase, 'FAIL', 'succeeded, expected an error');
  exception when others then
    msg := sqlerrm;
    if fragment is null or position(lower(fragment) in lower(msg)) > 0 then
      perform pg_temp.note(test_id, phase, 'PASS', msg);
    else
      perform pg_temp.note(test_id, phase, 'FAIL', msg);
    end if;
  end;
  execute 'reset role';
  perform pg_temp.clear_auth();
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note(test_id, phase, 'FAIL', sqlerrm);
end;
$$;

select set_config('pickuply.phone_hmac_secret', 'audit-local-secret', true);
select set_config('pickuply.driver_review', 'yes', true);
select set_config('pickuply.driver_online', 'yes', true);
select pg_temp.clear_auth();

do $$
declare
  uid uuid;
  email text;
begin
  for uid, email in
    select * from (values
      ('a11d0001-0000-4000-8000-000000000001'::uuid, 'audit-c1@pickuply.test'),
      ('a11d0001-0000-4000-8000-000000000002'::uuid, 'audit-c2@pickuply.test'),
      ('a11d0001-0000-4000-8000-000000000003'::uuid, 'audit-c3@pickuply.test'),
      ('a11d0001-0000-4000-8000-000000000004'::uuid, 'audit-c4@pickuply.test'),
      ('a11d0001-0000-4000-8000-000000000005'::uuid, 'audit-c5@pickuply.test'),
      ('a11d0002-0000-4000-8000-000000000001'::uuid, 'audit-d1@pickuply.test'),
      ('a11d0002-0000-4000-8000-000000000002'::uuid, 'audit-d2@pickuply.test'),
      ('a11d0002-0000-4000-8000-000000000003'::uuid, 'audit-d3@pickuply.test'),
      ('a11d0002-0000-4000-8000-000000000004'::uuid, 'audit-d4@pickuply.test'),
      ('a11d0002-0000-4000-8000-000000000005'::uuid, 'audit-d5@pickuply.test'),
      ('a11d0002-0000-4000-8000-000000000006'::uuid, 'audit-d6@pickuply.test'),
      ('a11d0002-0000-4000-8000-000000000007'::uuid, 'audit-d7@pickuply.test'),
      ('a11d0003-0000-4000-8000-000000000001'::uuid, 'audit-a1@pickuply.test')
    ) as people(uid, email)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      email, 'audit-hash', now(), '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb, now(), now(), now(), uid::text, '', uid::text || '-email', uid::text || '-recovery'
    );
  end loop;
end $$;

update public.profiles set full_name = 'Audit C1', phone = '5555550401' where id = 'a11d0001-0000-4000-8000-000000000001';
update public.profiles set full_name = 'Audit C2', phone = '5555550402' where id = 'a11d0001-0000-4000-8000-000000000002';
update public.profiles set full_name = 'Audit C3', phone = '5555550403' where id = 'a11d0001-0000-4000-8000-000000000003';
update public.profiles set full_name = 'Audit C4', phone = '5555550404' where id = 'a11d0001-0000-4000-8000-000000000004';
update public.profiles set full_name = 'Audit C5', phone = '5555550405' where id = 'a11d0001-0000-4000-8000-000000000005';
update public.profiles set full_name = 'Audit D1', phone = '5555550411' where id = 'a11d0002-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'Audit D2', phone = '5555550412' where id = 'a11d0002-0000-4000-8000-000000000002';
update public.profiles set role = 'driver', full_name = 'Audit D3', phone = '5555550413' where id = 'a11d0002-0000-4000-8000-000000000003';
update public.profiles set role = 'driver', full_name = 'Audit D4', phone = '5555550414' where id = 'a11d0002-0000-4000-8000-000000000004';
update public.profiles set role = 'driver', full_name = 'Audit D5', phone = '5555550415' where id = 'a11d0002-0000-4000-8000-000000000005';
update public.profiles set role = 'driver', full_name = 'Audit D6', phone = '5555550416' where id = 'a11d0002-0000-4000-8000-000000000006';
update public.profiles set full_name = 'Audit D7', phone = '5555550417' where id = 'a11d0002-0000-4000-8000-000000000007';
update public.profiles set role = 'admin', full_name = 'Audit A1', phone = '5555550421' where id = 'a11d0003-0000-4000-8000-000000000001';

insert into public.drivers (
  profile_id, status, zone_id, service_level, services, is_online, license_url, license_expires, home_city, home_zip
)
select person.id, person.status, zones.id, 'full', array['delivery','junk']::public.job_service[], person.online, person.license, public.georgia_today() + 400, person.city, person.zip
from (values
  ('a11d0002-0000-4000-8000-000000000002'::uuid, 'pending_review'::public.driver_status, false, 'a11d0002-0000-4000-8000-000000000002/license.jpg', 'Austell', '30106'),
  ('a11d0002-0000-4000-8000-000000000003'::uuid, 'active'::public.driver_status, false, 'a11d0002-0000-4000-8000-000000000003/license.jpg', 'Austell', '30106'),
  ('a11d0002-0000-4000-8000-000000000004'::uuid, 'active'::public.driver_status, true, 'a11d0002-0000-4000-8000-000000000004/license.jpg', 'Austell', '30106'),
  ('a11d0002-0000-4000-8000-000000000005'::uuid, 'active'::public.driver_status, true, 'a11d0002-0000-4000-8000-000000000005/license.jpg', 'Austell', '30106'),
  ('a11d0002-0000-4000-8000-000000000006'::uuid, 'active'::public.driver_status, true, 'a11d0002-0000-4000-8000-000000000006/license.jpg', 'Savannah', '31401')
) as person(id, status, online, license, city, zip)
cross join lateral (select id from public.zones where slug = 'west_metro' limit 1) as zones;

insert into public.vehicles (driver_id, type, approved)
select id, 'suv'::public.vehicle_type, true
from (values
  ('a11d0002-0000-4000-8000-000000000002'::uuid),
  ('a11d0002-0000-4000-8000-000000000003'::uuid),
  ('a11d0002-0000-4000-8000-000000000004'::uuid),
  ('a11d0002-0000-4000-8000-000000000005'::uuid),
  ('a11d0002-0000-4000-8000-000000000006'::uuid)
) as drivers(id);

select public.apply_driver_coverage('a11d0002-0000-4000-8000-000000000003', array['Austell'], array['30106'], 25, '30106');
select public.apply_driver_coverage('a11d0002-0000-4000-8000-000000000004', array['Austell'], array['30106'], 25, '30106');
select public.apply_driver_coverage('a11d0002-0000-4000-8000-000000000005', array['Austell'], array['30106'], 25, '30106');
select public.apply_driver_coverage('a11d0002-0000-4000-8000-000000000006', array['Savannah'], array['31401'], 10, '31401');

insert into public.account_suspensions (profile_id, status, kind, reason, created_by)
values (
  'a11d0002-0000-4000-8000-000000000005',
  'active',
  'indefinite',
  'Audit suspension',
  'a11d0003-0000-4000-8000-000000000001'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description,
  pieces, size, stairs_pickup, stairs_dropoff, elevator, help_loading, preferred_date,
  pricing_method, offer_cents, price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents
) values
(
  'a11d0004-0000-4000-8000-000000000001', 'a11d0001-0000-4000-8000-000000000002',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell, 30106', 'Smyrna, 30080', 'audit dresser',
  1, 'medium', 0, 0, false, false, 'asap',
  'quote', null, null, 4250, 750, 250
),
(
  'a11d0004-0000-4000-8000-000000000002', 'a11d0001-0000-4000-8000-000000000003',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell, 30106', 'Smyrna, 30080', 'audit active booking',
  1, 'medium', 0, 0, false, true, 'asap',
  'fixed', 5000, 5250, 4250, 750, 250
),
(
  'a11d0004-0000-4000-8000-000000000003', 'a11d0001-0000-4000-8000-000000000003',
  'junk', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell, 30106', null, 'audit junk',
  1, 'medium', 0, null, false, false, 'asap',
  'fixed', 5000, 5250, 4250, 750, 250
),
(
  'a11d0004-0000-4000-8000-000000000004', 'a11d0001-0000-4000-8000-000000000005',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell, 30106', 'Smyrna, 30080', 'audit cancelled',
  1, 'medium', 0, 0, false, false, 'asap',
  'fixed', 5000, 5250, 4250, 750, 250
),
(
  'a11d0004-0000-4000-8000-000000000005', 'a11d0001-0000-4000-8000-000000000004',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell, 30106', 'Smyrna, 30080', 'audit completed',
  1, 'medium', 0, 0, false, false, 'asap',
  'fixed', 5000, 5250, 4250, 750, 250
);

select set_config('pickuply.job_claimed', 'yes', true);
select set_config('pickuply.system_payment', 'yes', true);
update public.jobs
set status = 'assigned', assigned_driver_id = 'a11d0002-0000-4000-8000-000000000004', payment_status = 'authorized'
where id in (
  'a11d0004-0000-4000-8000-000000000002',
  'a11d0004-0000-4000-8000-000000000003'
);
update public.jobs set status = 'cancelled' where id = 'a11d0004-0000-4000-8000-000000000004';
update public.jobs
set status = 'assigned', assigned_driver_id = 'a11d0002-0000-4000-8000-000000000004', payment_status = 'authorized'
where id = 'a11d0004-0000-4000-8000-000000000005';
update public.jobs
set status = 'completed', payment_status = 'captured'
where id = 'a11d0004-0000-4000-8000-000000000005';
select set_config('pickuply.job_claimed', 'no', true);
select set_config('pickuply.system_payment', 'no', true);

select set_config('pickuply.driver_review', 'no', true);
select set_config('pickuply.driver_online', 'no', true);

-- Fees from the settings row the database actually uses.
do $$
declare
  price jsonb;
  bps integer;
  fee_bps integer;
begin
  select platform_bps, service_fee_bps into bps, fee_bps from public.platform_settings where id = 1;
  price := public.price_breakdown('accept', 5000);
  perform pg_temp.note(
    'PAY-013', 'payments',
    case when (price->>'platform_fee_cents')::int = public.round_half_up(5000::bigint * bps, 10000)
      and (price->>'driver_earnings_cents')::int = 5000 - (price->>'platform_fee_cents')::int
      then 'PASS' else 'FAIL' end,
    'commission bps ' || bps || ' breakdown ' || price::text
  );
  perform pg_temp.note(
    'PAY-014', 'payments',
    case when (price->>'service_fee_cents')::int = public.round_half_up(5000::bigint * fee_bps, 10000)
      and (price->>'customer_total_cents')::int = 5000 + (price->>'service_fee_cents')::int
      then 'PASS' else 'FAIL' end,
    'service fee bps ' || fee_bps || ' breakdown ' || price::text
  );
  perform pg_temp.note(
    'PAY-015', 'payments',
    case when bps = 1500 and (price->>'driver_earnings_cents')::int = 4250 then 'PASS' else 'FAIL' end,
    'expected 85 percent of 5000 when commission is 15 percent; driver ' || coalesce(price->>'driver_earnings_cents', 'null') || ' at ' || bps || ' bps'
  );
  perform pg_temp.note(
    'BOOK-011', 'booking',
    case when (price->>'customer_total_cents')::int = (price->>'subtotal_cents')::int + (price->>'service_fee_cents')::int then 'PASS' else 'FAIL' end,
    price::text
  );
  perform pg_temp.note(
    'BOOK-012', 'booking',
    case when fee_bps = 500 and (price->>'service_fee_cents')::int = 250 then 'PASS' else 'FAIL' end,
    'service fee ' || coalesce(price->>'service_fee_cents', 'null') || ' at ' || fee_bps || ' bps'
  );
end $$;

-- Customer creates one request and a repeat does not add a second job.
do $$
declare
  created uuid;
  before_count integer;
  after_count integer;
begin
  perform pg_temp.as_user('a11d0001-0000-4000-8000-000000000001');
  created := public.create_customer_request(
    'a11d0004-0000-4000-8000-000000000010',
    jsonb_build_object(
      'service', 'delivery',
      'description', 'Audit new dresser',
      'pieces', '1',
      'size', 'medium',
      'stairs_pickup', '0',
      'stairs_dropoff', '0',
      'elevator', false,
      'help_loading', true,
      'preferred_date', 'asap',
      'pricing_method', 'fixed',
      'offer_cents', '5000',
      'budget_min_cents', null,
      'budget_max_cents', null,
      'pickup_area', 'Austell, 30106',
      'dropoff_area', 'Smyrna, 30080',
      'pickup_address', '10 Audit Street',
      'dropoff_address', '20 Audit Avenue',
      'customer_name', 'Audit C1',
      'customer_phone', '+15555550401'
    )
  );
  select count(*) into before_count from public.jobs where id = created;
  perform public.create_customer_request(
    'a11d0004-0000-4000-8000-000000000010',
    jsonb_build_object(
      'service', 'delivery',
      'description', 'Audit new dresser',
      'pieces', '1',
      'size', 'medium',
      'stairs_pickup', '0',
      'stairs_dropoff', '0',
      'elevator', false,
      'help_loading', true,
      'preferred_date', 'asap',
      'pricing_method', 'fixed',
      'offer_cents', '5000',
      'budget_min_cents', null,
      'budget_max_cents', null,
      'pickup_area', 'Austell, 30106',
      'dropoff_area', 'Smyrna, 30080',
      'pickup_address', '10 Audit Street',
      'dropoff_address', '20 Audit Avenue',
      'customer_name', 'Audit C1',
      'customer_phone', '+15555550401'
    )
  );
  select count(*) into after_count from public.jobs where customer_id = 'a11d0001-0000-4000-8000-000000000001';
  perform pg_temp.note('BOOK-001', 'booking', case when before_count = 1 then 'PASS' else 'FAIL' end, 'created ' || created::text);
  perform pg_temp.note('BOOK-005', 'booking', case when (select description from public.jobs where id = created) = 'Audit new dresser' then 'PASS' else 'FAIL' end, 'description stored');
  perform pg_temp.note('BOOK-023', 'booking', case when after_count = before_count then 'PASS' else 'FAIL' end, 'jobs after retry ' || after_count::text);
  perform pg_temp.note(
    'BOOK-004', 'booking',
    case when exists (
      select 1 from public.job_private
      where job_id = created and pickup_address = '10 Audit Street'
    ) then 'PASS' else 'FAIL' end,
    'private pickup address'
  );
  execute 'reset role';
  perform pg_temp.clear_auth();
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note('BOOK-001', 'booking', 'FAIL', sqlerrm);
end $$;

select pg_temp.expect_error(
  'BOOK-010', 'booking', 'a11d0001-0000-4000-8000-000000000001',
  $$select public.create_customer_request('a11d0004-0000-4000-8000-000000000011', '{"service":"delivery","pricing_method":"fixed"}'::jsonb)$$,
  null
);

select pg_temp.expect_error(
  'CUST-013', 'customer', 'a11d0001-0000-4000-8000-000000000001',
  $$select public.review_driver('a11d0002-0000-4000-8000-000000000002', 'approve_active', null, true)$$,
  'admin'
);

do $$
declare
  visible integer;
  other_private integer;
begin
  perform pg_temp.as_user('a11d0001-0000-4000-8000-000000000001');
  select count(*) into visible from public.jobs where id = 'a11d0004-0000-4000-8000-000000000002';
  select count(*) into other_private from public.job_private where job_id = 'a11d0004-0000-4000-8000-000000000002';
  perform pg_temp.note('SEC-CUSTOMER-JOB', 'security', case when visible = 0 and other_private = 0 then 'PASS' else 'FAIL' end, 'other job rows ' || visible::text || ' private ' || other_private::text);
  execute 'reset role';
  perform pg_temp.clear_auth();
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note('SEC-CUSTOMER-JOB', 'security', 'FAIL', sqlerrm);
end $$;

do $$
declare
  name_after text;
begin
  perform pg_temp.as_user('a11d0001-0000-4000-8000-000000000002');
  update public.profiles set full_name = 'Audit C2 Edited' where id = auth.uid();
  select full_name into name_after from public.profiles where id = auth.uid();
  perform pg_temp.note('CUST-009', 'customer', case when name_after = 'Audit C2 Edited' then 'PASS' else 'FAIL' end, coalesce(name_after, 'null'));
  execute 'reset role';
  perform pg_temp.clear_auth();
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note('CUST-009', 'customer', 'FAIL', sqlerrm);
end $$;

do $$
declare
  dup_ok boolean := false;
begin
  update auth.users set phone = '15555550401' where id = 'a11d0001-0000-4000-8000-000000000001';
  begin
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token, phone
    ) values (
      '00000000-0000-0000-0000-000000000000', 'a11d0001-0000-4000-8000-000000000099',
      'authenticated', 'authenticated', 'audit-dup@pickuply.test', 'audit-hash', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
      'dup-token', '', 'dup-email', 'dup-recovery', '15555550401'
    );
  exception when unique_violation then
    dup_ok := true;
  end;
  perform pg_temp.note('CUST-014', 'customer', case when dup_ok then 'PASS' else 'FAIL' end, 'second auth row with the same phone');
end $$;

-- Driver application rules.
select pg_temp.expect_error(
  'DRV-014', 'driver', 'a11d0002-0000-4000-8000-000000000001',
  $sql$select public.submit_quick_application(jsonb_build_object(
    'full_name', 'Audit Driver', 'contact_ok', 'true', 'terms_ok', 'true',
    'email', 'audit-d1@pickuply.test', 'home_city', 'Austell', 'home_zip', '30106',
    'service_level', 'light', 'vehicle_type', 'suv',
    'photo_path', 'a11d0002-0000-4000-8000-000000000001/profile.jpg',
    'license_path', 'a11d0002-0000-4000-8000-000000000001/license.jpg',
    'license_expires', '2000-01-01'
  ))$sql$,
  'expiration'
);

select pg_temp.expect_error(
  'DRV-015', 'driver', 'a11d0002-0000-4000-8000-000000000007',
  $$select public.submit_quick_application('{"full_name":"Audit Seven","contact_ok":"true","terms_ok":"true","email":"audit-d7@pickuply.test","home_city":"Austell","home_zip":"30106","service_level":"light","vehicle_type":"car"}'::jsonb)$$,
  'photo'
);

do $$
declare
  expires text := to_char(public.georgia_today() + 400, 'YYYY-MM-DD');
begin
  perform pg_temp.as_user('a11d0002-0000-4000-8000-000000000001');
  perform public.submit_quick_application(jsonb_build_object(
    'full_name', 'Audit Driver',
    'contact_ok', 'true',
    'terms_ok', 'true',
    'email', 'audit-d1@pickuply.test',
    'home_city', 'Austell',
    'home_zip', '30106',
    'service_level', 'full',
    'vehicle_type', 'van',
    'photo_path', 'a11d0002-0000-4000-8000-000000000001/profile.jpg',
    'license_path', 'a11d0002-0000-4000-8000-000000000001/license.jpg',
    'license_expires', expires,
    'coverage', jsonb_build_object('cities', jsonb_build_array('Austell'), 'zips', jsonb_build_array('30106'), 'radius', 25, 'radius_zip', '30106')
  ));
  perform pg_temp.note(
    'DRV-016', 'driver',
    case when (select status::text from public.drivers where profile_id = 'a11d0002-0000-4000-8000-000000000001') = 'pending_review' then 'PASS' else 'FAIL' end,
    coalesce((select status::text from public.drivers where profile_id = 'a11d0002-0000-4000-8000-000000000001'), 'missing')
  );
  perform pg_temp.note(
    'DRV-005', 'driver',
    case when (select home_zip from public.drivers where profile_id = 'a11d0002-0000-4000-8000-000000000001') = '30106' then 'PASS' else 'FAIL' end,
    coalesce((select home_city || ' ' || home_zip from public.drivers where profile_id = 'a11d0002-0000-4000-8000-000000000001'), 'missing')
  );
  perform pg_temp.note(
    'DRV-011', 'driver',
    case when exists (select 1 from public.vehicles where driver_id = 'a11d0002-0000-4000-8000-000000000001' and type = 'van') then 'PASS' else 'FAIL' end,
    'vehicle row'
  );
  perform pg_temp.note(
    'DRV-017', 'driver',
    case when (select status::text from public.drivers where profile_id = 'a11d0002-0000-4000-8000-000000000001') = 'pending_review' then 'PASS' else 'FAIL' end,
    'pending_review is the admin pending state'
  );
  execute 'reset role';
  perform pg_temp.clear_auth();
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note('DRV-016', 'driver', 'FAIL', sqlerrm);
end $$;

do $$
declare
  other_license integer;
  admin_license integer;
begin
  perform pg_temp.as_user('a11d0001-0000-4000-8000-000000000001');
  select count(*) into other_license from public.drivers where profile_id = 'a11d0002-0000-4000-8000-000000000004';
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.as_user('a11d0003-0000-4000-8000-000000000001');
  select count(*) into admin_license from public.drivers where profile_id = 'a11d0002-0000-4000-8000-000000000004' and license_url is not null;
  perform pg_temp.note('DRV-025', 'driver', case when other_license = 0 and admin_license = 1 then 'PASS' else 'FAIL' end, 'customer sees ' || other_license::text || ', admin sees ' || admin_license::text);
  execute 'reset role';
  perform pg_temp.clear_auth();
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note('DRV-025', 'driver', 'FAIL', sqlerrm);
end $$;

do $$
declare
  logged integer;
begin
  perform pg_temp.as_user('a11d0003-0000-4000-8000-000000000001');
  perform public.review_driver('a11d0002-0000-4000-8000-000000000002', 'approve_active', null, true);
  perform pg_temp.note(
    'DRV-018', 'driver',
    case when (select status::text from public.drivers where profile_id = 'a11d0002-0000-4000-8000-000000000002') = 'active'
      and (select role::text from public.profiles where id = 'a11d0002-0000-4000-8000-000000000002') = 'driver'
      then 'PASS' else 'FAIL' end,
    coalesce((select status::text || '/' || is_online::text from public.drivers where profile_id = 'a11d0002-0000-4000-8000-000000000002'), 'missing')
  );
  select count(*) into logged from public.audit_log
  where actor_id = 'a11d0003-0000-4000-8000-000000000001' and target_id = 'a11d0002-0000-4000-8000-000000000002';
  perform pg_temp.note('ADMIN-D-030', 'admin-driver', case when logged > 0 then 'PASS' else 'FAIL' end, 'audit rows ' || logged::text);
  perform public.review_driver('a11d0002-0000-4000-8000-000000000001', 'request_changes', 'Add a clearer license photo', false);
  perform pg_temp.note(
    'ADMIN-D-009', 'admin-driver',
    case when (select review_note from public.drivers where profile_id = 'a11d0002-0000-4000-8000-000000000001') like 'Add a clearer%' then 'PASS' else 'FAIL' end,
    coalesce((select review_note from public.drivers where profile_id = 'a11d0002-0000-4000-8000-000000000001'), 'missing')
  );
  execute 'reset role';
  perform pg_temp.clear_auth();
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note('DRV-018', 'driver', 'FAIL', sqlerrm);
end $$;

select pg_temp.expect_error(
  'ADMIN-D-031', 'admin-driver', 'a11d0001-0000-4000-8000-000000000001',
  $$select public.review_driver('a11d0002-0000-4000-8000-000000000003', 'pause', 'audit pause', false)$$,
  'admin'
);

select pg_temp.expect_error(
  'DRV-020', 'driver', 'a11d0002-0000-4000-8000-000000000001',
  $$select public.claim_job('a11d0004-0000-4000-8000-000000000001')$$,
  null
);

select pg_temp.expect_error(
  'DRV-021', 'driver', 'a11d0002-0000-4000-8000-000000000003',
  $$select public.claim_job('a11d0004-0000-4000-8000-000000000001')$$,
  'online'
);

select pg_temp.expect_error(
  'DRV-023', 'driver', 'a11d0002-0000-4000-8000-000000000005',
  $$select public.claim_job('a11d0004-0000-4000-8000-000000000001')$$,
  'restricted'
);

do $$
declare
  matched integer;
  far_matched integer;
  georgia integer;
  pay integer;
begin
  perform pg_temp.as_user('a11d0002-0000-4000-8000-000000000004');
  select count(*) into matched from public.driver_matched_feed() where id = 'a11d0004-0000-4000-8000-000000000001';
  select count(*) into georgia from public.driver_job_feed() where id = 'a11d0004-0000-4000-8000-000000000001';
  select driver_pay_cents into pay from public.driver_matched_feed() where id = 'a11d0004-0000-4000-8000-000000000001';
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.as_user('a11d0002-0000-4000-8000-000000000006');
  select count(*) into far_matched from public.driver_matched_feed() where id = 'a11d0004-0000-4000-8000-000000000001';
  perform pg_temp.note('OFFER-001', 'offers', case when matched = 1 then 'PASS' else 'FAIL' end, 'Austell matched count ' || matched::text);
  perform pg_temp.note('OFFER-002', 'offers', case when far_matched = 0 then 'PASS' else 'FAIL' end, 'Savannah matched count ' || far_matched::text || '; all-Georgia feed is allowed to show it');
  perform pg_temp.note('OFFER-004', 'offers', case when georgia = 1 then 'PASS' else 'FAIL' end, 'feed count ' || georgia::text);
  perform pg_temp.note('OFFER-006', 'offers', case when pay = 4250 then 'PASS' else 'FAIL' end, 'matched driver pay ' || coalesce(pay::text, 'null'));
  execute 'reset role';
  perform pg_temp.clear_auth();
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note('OFFER-001', 'offers', 'FAIL', sqlerrm);
end $$;

do $$
declare
  street text;
  winner uuid;
  alerts integer;
begin
  perform pg_temp.as_user('a11d0002-0000-4000-8000-000000000004');
  select pickup_address into street from public.job_private where job_id = 'a11d0004-0000-4000-8000-000000000001';
  perform pg_temp.note('OFFER-005', 'offers', case when street is null then 'PASS' else 'FAIL' end, 'unassigned private street ' || coalesce(street, 'hidden'));
  perform public.claim_job('a11d0004-0000-4000-8000-000000000001');
  select assigned_driver_id into winner from public.jobs where id = 'a11d0004-0000-4000-8000-000000000001';
  perform pg_temp.note('OFFER-007', 'offers', case when winner = 'a11d0002-0000-4000-8000-000000000004' then 'PASS' else 'FAIL' end, coalesce(winner::text, 'null'));
  perform pg_temp.note(
    'OFFER-014', 'offers',
    case when exists (
      select 1 from public.job_events
      where job_id = 'a11d0004-0000-4000-8000-000000000001' and type = 'claimed'
    ) then 'PASS' else 'FAIL' end,
    'claimed event'
  );
  select count(*) into alerts from public.notifications
  where job_id = 'a11d0004-0000-4000-8000-000000000001' and kind in ('driver_confirmed', 'assigned', 'payment_needed');
  perform pg_temp.note('OFFER-015', 'offers', case when alerts >= 1 then 'PASS' else 'FAIL' end, 'notification rows ' || alerts::text);
  execute 'reset role';
  perform pg_temp.clear_auth();
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note('OFFER-007', 'offers', 'FAIL', sqlerrm);
end $$;

do $$
begin
  perform pg_temp.as_user('a11d0002-0000-4000-8000-000000000003');
  perform public.accept_driver_terms();
  perform public.set_driver_online(true);
  begin
    perform public.claim_job('a11d0004-0000-4000-8000-000000000001');
    perform pg_temp.note('OFFER-010', 'offers', 'FAIL', 'second driver claimed the job');
  exception when others then
    perform pg_temp.note('OFFER-010', 'offers', case when sqlerrm ilike '%taken%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
  execute 'reset role';
  perform pg_temp.clear_auth();
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note('OFFER-010', 'offers', 'FAIL', sqlerrm);
end $$;

do $$
declare
  still uuid;
  visible integer;
begin
  select assigned_driver_id into still from public.jobs where id = 'a11d0004-0000-4000-8000-000000000001';
  perform pg_temp.as_user('a11d0002-0000-4000-8000-000000000006');
  select count(*) into visible from public.driver_job_feed() where id = 'a11d0004-0000-4000-8000-000000000001';
  perform pg_temp.note('OFFER-017', 'offers', case when visible = 0 and still = 'a11d0002-0000-4000-8000-000000000004' then 'PASS' else 'FAIL' end, 'feed ' || visible::text || ' winner ' || coalesce(still::text, 'null'));
  execute 'reset role';
  perform pg_temp.clear_auth();
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note('OFFER-017', 'offers', 'FAIL', sqlerrm);
end $$;

do $$
declare
  outcome jsonb;
  status text;
begin
  perform pg_temp.as_user('a11d0001-0000-4000-8000-000000000002');
  outcome := public.begin_customer_cancel('a11d0004-0000-4000-8000-000000000001');
  select jobs.status::text into status from public.jobs where id = 'a11d0004-0000-4000-8000-000000000001';
  perform pg_temp.note('BOOK-021', 'booking', case when status = 'cancelled' then 'PASS' else 'FAIL' end, coalesce(outcome::text, 'null') || ' status ' || coalesce(status, 'null'));
  perform pg_temp.note('BOOK-022', 'booking', case when status = 'cancelled' then 'PASS' else 'FAIL' end, 'cancel wrote cancelled');
  execute 'reset role';
  perform pg_temp.clear_auth();
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note('BOOK-021', 'booking', 'FAIL', sqlerrm);
end $$;

select pg_temp.expect_error(
  'OFFER-012', 'offers', 'a11d0002-0000-4000-8000-000000000004',
  $$select public.claim_job('a11d0004-0000-4000-8000-000000000004')$$,
  null
);

-- Delivery lifecycle on the authorized assigned job.
do $$
declare
  status text;
  confirmed timestamptz;
  thread uuid;
  closed timestamptz;
  captured text;
  earnings integer;
begin
  perform pg_temp.as_user('a11d0002-0000-4000-8000-000000000004');
  perform public.advance_job('a11d0004-0000-4000-8000-000000000002', 'en_route');
  perform public.advance_job('a11d0004-0000-4000-8000-000000000002', 'arrived');
  begin
    perform public.advance_job('a11d0004-0000-4000-8000-000000000002', 'item_check');
    perform pg_temp.note('DEL-007', 'delivery', 'FAIL', 'item loaded without a pickup photo');
  exception when others then
    perform pg_temp.note('DEL-007', 'delivery', case when sqlerrm ilike '%photo%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
  perform public.record_proof(
    'a11d0004-0000-4000-8000-000000000002', 'pickup',
    'a11d0004-0000-4000-8000-000000000002/pickup/a11d0004-0000-4000-8000-000000000021.jpg',
    '', 'photo', false, null, null
  );
  begin
    perform public.record_proof(
      'a11d0004-0000-4000-8000-000000000002', 'pickup',
      'a11d0004-0000-4000-8000-000000000002/pickup/a11d0004-0000-4000-8000-000000000021.jpg',
      '', 'photo', false, null, null
    );
  exception when unique_violation then
    null;
  end;
  perform pg_temp.note(
    'DEL-009', 'delivery',
    case when (select count(*) from public.job_photos where job_id = 'a11d0004-0000-4000-8000-000000000002' and stage = 'pickup') = 1 then 'PASS' else 'FAIL' end,
    'pickup photo rows ' || (select count(*) from public.job_photos where job_id = 'a11d0004-0000-4000-8000-000000000002' and stage = 'pickup')::text
  );
  perform public.advance_job('a11d0004-0000-4000-8000-000000000002', 'item_check');
  perform public.advance_job('a11d0004-0000-4000-8000-000000000002', 'in_transit');
  perform public.advance_job('a11d0004-0000-4000-8000-000000000002', 'at_dropoff');
  begin
    perform public.advance_job('a11d0004-0000-4000-8000-000000000002', 'delivered');
    perform pg_temp.note('DEL-013', 'delivery', 'FAIL', 'delivered without drop-off proof');
  exception when others then
    perform pg_temp.note('DEL-013', 'delivery', case when sqlerrm ilike '%photo%' or sqlerrm ilike '%proof%' or sqlerrm ilike '%drop%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
  perform public.record_proof(
    'a11d0004-0000-4000-8000-000000000002', 'dropoff',
    'a11d0004-0000-4000-8000-000000000002/dropoff/a11d0004-0000-4000-8000-000000000022.jpg',
    '', 'photo', false, null, null
  );
  perform public.advance_job('a11d0004-0000-4000-8000-000000000002', 'delivered');
  select jobs.status::text into status from public.jobs where id = 'a11d0004-0000-4000-8000-000000000002';
  perform pg_temp.note('DEL-012', 'delivery', case when status = 'delivered' then 'PASS' else 'FAIL' end, coalesce(status, 'null'));
  execute 'reset role';
  perform pg_temp.clear_auth();

  perform pg_temp.as_user('a11d0002-0000-4000-8000-000000000006');
  begin
    perform public.advance_job('a11d0004-0000-4000-8000-000000000002', 'en_route');
    perform pg_temp.note('DEL-021', 'delivery', 'FAIL', 'other driver advanced the job');
  exception when others then
    perform pg_temp.note('DEL-021', 'delivery', 'PASS', sqlerrm);
  end;
  execute 'reset role';
  perform pg_temp.clear_auth();

  perform pg_temp.as_user('a11d0001-0000-4000-8000-000000000003');
  perform public.confirm_delivery('a11d0004-0000-4000-8000-000000000002');
  select customer_confirmed_at into confirmed from public.jobs where id = 'a11d0004-0000-4000-8000-000000000002';
  perform pg_temp.note('DEL-014', 'delivery', case when confirmed is not null then 'PASS' else 'FAIL' end, 'confirmed at ' || coalesce(confirmed::text, 'null'));
  execute 'reset role';
  perform pg_temp.clear_auth();

  perform public.record_capture('a11d0004-0000-4000-8000-000000000002', 5250, 'full', 0);
  select jobs.status::text || '/' || payment_status::text into captured from public.jobs where id = 'a11d0004-0000-4000-8000-000000000002';
  perform pg_temp.note('PAY-008', 'payments', case when captured = 'completed/captured' then 'PASS' else 'FAIL' end, coalesce(captured, 'null'));
  perform public.post_driver_earnings('a11d0004-0000-4000-8000-000000000002', now());
  select amount_cents into earnings from public.ledger_entries
  where job_id = 'a11d0004-0000-4000-8000-000000000002' and entry_kind is distinct from 'tip'
  order by created_at desc limit 1;
  perform pg_temp.note('PAY-012', 'payments', case when earnings = 4250 then 'PASS' else 'FAIL' end, 'ledger ' || coalesce(earnings::text, 'null'));

  select id, closes_at into thread, closed from public.message_threads where job_id = 'a11d0004-0000-4000-8000-000000000002';
  perform pg_temp.note('DEL-016', 'delivery', case when closed is not null then 'PASS' else 'FAIL' end, 'thread ' || coalesce(thread::text, 'missing') || ' closes ' || coalesce(closed::text, 'null'));
  if thread is not null then
    perform pg_temp.as_user('a11d0001-0000-4000-8000-000000000003');
    begin
      perform public.post_message(thread, 'hello after completion');
      perform pg_temp.note('DEL-016B', 'delivery', 'FAIL', 'message posted after completion');
    exception when others then
      perform pg_temp.note('DEL-016B', 'delivery', case when sqlerrm ilike '%closed%' then 'PASS' else 'FAIL' end, sqlerrm);
    end;
    execute 'reset role';
    perform pg_temp.clear_auth();
  end if;
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note('DEL-002', 'delivery', 'FAIL', sqlerrm);
end $$;

-- Junk removal finishes from the pickup.
do $$
declare
  status text;
begin
  perform pg_temp.as_user('a11d0002-0000-4000-8000-000000000004');
  perform public.advance_job('a11d0004-0000-4000-8000-000000000003', 'en_route');
  perform public.advance_job('a11d0004-0000-4000-8000-000000000003', 'arrived');
  perform public.record_proof(
    'a11d0004-0000-4000-8000-000000000003', 'pickup',
    'a11d0004-0000-4000-8000-000000000003/pickup/a11d0004-0000-4000-8000-000000000031.jpg',
    '', 'photo', false, null, null
  );
  perform public.advance_job('a11d0004-0000-4000-8000-000000000003', 'delivered');
  select jobs.status::text into status from public.jobs where id = 'a11d0004-0000-4000-8000-000000000003';
  perform pg_temp.note('DEL-019', 'delivery', case when status = 'delivered' then 'PASS' else 'FAIL' end, coalesce(status, 'null'));
  execute 'reset role';
  perform pg_temp.clear_auth();
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note('DEL-019', 'delivery', 'FAIL', sqlerrm);
end $$;

-- Cancel closes the chat.
do $$
declare
  thread uuid;
  closed timestamptz;
begin
  select id into thread from public.message_threads where job_id = 'a11d0004-0000-4000-8000-000000000004';
  select closes_at into closed from public.message_threads where id = thread;
  perform pg_temp.note('DEL-017', 'delivery', case when thread is null or closed is not null then 'PASS' else 'FAIL' end, 'cancelled thread ' || coalesce(thread::text, 'none') || ' closes ' || coalesce(closed::text, 'null'));
exception when others then
  perform pg_temp.note('DEL-017', 'delivery', 'FAIL', sqlerrm);
end $$;

-- Contact details are rejected. A normal message is stored.
do $$
declare
  thread uuid;
begin
  perform pg_temp.as_user('a11d0001-0000-4000-8000-000000000003');
  select id into thread from public.message_threads where job_id = 'a11d0004-0000-4000-8000-000000000003' and closes_at is null;
  if thread is null then
    perform pg_temp.note('MSG-001', 'messaging', 'FAIL', 'no open junk thread');
  else
    begin
      perform public.post_message(thread, 'call me at 555-555-0199');
      perform pg_temp.note('MSG-001', 'messaging', 'FAIL', 'phone number was accepted');
    exception when others then
      perform pg_temp.note('MSG-001', 'messaging', case when sqlerrm ilike '%contact%' then 'PASS' else 'FAIL' end, sqlerrm);
    end;
    perform public.post_message(thread, 'Gate code is 1234');
    perform pg_temp.note('MSG-002', 'messaging', 'PASS', 'gate code stored');
  end if;
  execute 'reset role';
  perform pg_temp.clear_auth();
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note('MSG-001', 'messaging', 'FAIL', sqlerrm);
end $$;

-- Support ticket round trip.
do $$
declare
  reference text;
  ticket uuid;
  replies integer;
  ticket_ref text;
begin
  perform pg_temp.as_user('a11d0001-0000-4000-8000-000000000002');
  ticket_ref := public.create_support_ticket('Audit', 'Customer', 'audit-c2@pickuply.test', 'booking', 'Where is my driver?', null, null);
  select id into ticket from public.support_tickets where support_tickets.reference = ticket_ref;
  perform public.customer_support_reply(ticket, 'Still waiting.');
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.as_user('a11d0003-0000-4000-8000-000000000001');
  perform public.admin_support_message(ticket, 'We can see the booking.', false);
  execute 'reset role';
  perform pg_temp.clear_auth();
  select count(*) into replies from public.support_ticket_messages where ticket_id = ticket;
  perform pg_temp.note('ADMIN-C-011', 'admin-customer', case when ticket is not null and replies >= 3 then 'PASS' else 'FAIL' end, coalesce(ticket_ref, 'none') || ' messages ' || coalesce(replies::text, '0'));
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note('ADMIN-C-011', 'admin-customer', 'FAIL', sqlerrm);
end $$;

-- Tip: explicit begin, one ledger row for the full tip, live flag rejected, second confirm is duplicate.
do $$
declare
  tip jsonb;
  second jsonb;
  result text;
  again text;
  amount integer;
  rows integer;
begin
  perform pg_temp.as_user('a11d0001-0000-4000-8000-000000000003');
  tip := public.begin_tip('a11d0004-0000-4000-8000-000000000002', 500);
  second := public.begin_tip('a11d0004-0000-4000-8000-000000000002', 500);
  perform pg_temp.note('PAY-019', 'payments', case when tip->>'tip_id' = second->>'tip_id' then 'PASS' else 'FAIL' end, tip::text || ' / ' || second::text);
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    perform public.confirm_tip_payment((tip->>'tip_id')::uuid, 'pi_audit_tip', 'ch_audit_tip', 0, true);
    perform pg_temp.note('PAY-LIVE', 'payments', 'FAIL', 'live tip was accepted');
  exception when others then
    perform pg_temp.note('PAY-LIVE', 'payments', case when sqlerrm ilike '%live%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
  result := public.confirm_tip_payment((tip->>'tip_id')::uuid, 'pi_audit_tip', 'ch_audit_tip', 0, false);
  again := public.confirm_tip_payment((tip->>'tip_id')::uuid, 'pi_audit_tip', 'ch_audit_tip', 0, false);
  select amount_cents into amount from public.ledger_entries where tip_id = (tip->>'tip_id')::uuid;
  select count(*) into rows from public.ledger_entries where tip_id = (tip->>'tip_id')::uuid;
  perform pg_temp.note('PAY-016', 'payments', case when result = 'paid' and amount = 500 then 'PASS' else 'FAIL' end, result || ' amount ' || coalesce(amount::text, 'null'));
  perform pg_temp.note('PAY-020', 'payments', case when amount = 500 then 'PASS' else 'FAIL' end, 'driver ledger ' || coalesce(amount::text, 'null'));
  perform pg_temp.note('PAY-021', 'payments', case when amount = 500 then 'PASS' else 'FAIL' end, 'tip ledger equals the tip');
  perform pg_temp.note('PAY-019B', 'payments', case when again = 'duplicate' and rows = 1 then 'PASS' else 'FAIL' end, again || ' rows ' || rows::text);
  perform pg_temp.clear_auth();
exception when others then
  perform pg_temp.clear_auth();
  perform pg_temp.note('PAY-016', 'payments', 'FAIL', sqlerrm);
end $$;

select pg_temp.expect_error(
  'PAY-017', 'payments', 'a11d0001-0000-4000-8000-000000000001',
  $$select public.begin_tip('a11d0004-0000-4000-8000-000000000005', 500)$$,
  'customer'
);

-- Payout reminder for an approved driver without Connect.
do $$
declare
  before_count integer;
  after_count integer;
begin
  select count(*) into before_count from public.notifications
  where profile_id = 'a11d0002-0000-4000-8000-000000000002' and kind = 'payout_setup';
  perform pg_temp.as_user('a11d0002-0000-4000-8000-000000000002');
  perform public.remind_payout_setup();
  execute 'reset role';
  perform pg_temp.clear_auth();
  select count(*) into after_count from public.notifications
  where profile_id = 'a11d0002-0000-4000-8000-000000000002' and kind = 'payout_setup';
  perform pg_temp.note(
    'DRV-028', 'driver',
    case when before_count >= 1 and after_count = before_count then 'PASS' else 'FAIL' end,
    'payout alerts before ' || before_count::text || ' after ' || after_count::text
  );
exception when others then
  execute 'reset role';
  perform pg_temp.clear_auth();
  perform pg_temp.note('DRV-028', 'driver', 'FAIL', sqlerrm);
end $$;

-- Role separation: there is no support-admin role.
do $$
declare
  labels text;
begin
  select string_agg(enumlabel, ',') into labels
  from pg_enum
  where enumtypid = 'public.profile_role'::regtype;
  perform pg_temp.note('ADMIN-A2', 'admin', case when labels = 'customer,driver,admin' then 'NOT IMPLEMENTED' else 'FAIL' end, coalesce(labels, 'none'));
end $$;

select 'AUDIT|' || test_id || '|' || status || '|' || replace(replace(detail, '|', '/'), E'\n', ' ')
from audit_results
order by test_id;

rollback;
