-- Pickup availability, driver proposal, and the locked confirmed time.

begin;

select plan(55);

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

create or replace function pg_temp.day_offset(days integer)
returns text language sql stable as $$
  select to_char((timezone('America/New_York', now()))::date + days, 'YYYY-MM-DD');
$$;

select pg_temp.make_user('c1920000-0000-4000-8000-000000000001', 'sched-customer@pickuply.test');
select pg_temp.make_user('c1920000-0000-4000-8000-000000000002', 'sched-driver-a@pickuply.test');
select pg_temp.make_user('c1920000-0000-4000-8000-000000000003', 'sched-driver-b@pickuply.test');
select pg_temp.make_user('c1920000-0000-4000-8000-000000000004', 'sched-other@pickuply.test');

select pg_temp.clear_auth();
update public.profiles set full_name = 'Sched Customer' where id = 'c1920000-0000-4000-8000-000000000001';
update public.profiles set full_name = 'Driver A', role = 'driver' where id = 'c1920000-0000-4000-8000-000000000002';
update public.profiles set full_name = 'Driver B', role = 'driver' where id = 'c1920000-0000-4000-8000-000000000003';
update public.profiles set full_name = 'Other Customer' where id = 'c1920000-0000-4000-8000-000000000004';

insert into public.drivers (
  profile_id, status, zone_id, service_level, services, is_online,
  license_expires, terms_version, terms_accepted_at, agreement_signed_at
) values
  ('c1920000-0000-4000-8000-000000000002', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery', 'junk']::public.job_service[], true, current_date + 30, 'driver-terms-v1', now(), now()),
  ('c1920000-0000-4000-8000-000000000003', 'active', (select id from public.zones where slug = 'west_metro'), 'full', array['delivery', 'junk']::public.job_service[], true, current_date + 30, 'driver-terms-v1', now(), now());

insert into public.vehicles (driver_id, type, make, approved) values
  ('c1920000-0000-4000-8000-000000000002', 'pickup', 'Ford', true),
  ('c1920000-0000-4000-8000-000000000003', 'pickup', 'Ford', true);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  budget_min_cents, budget_max_cents
) values (
  'c1920000-0000-4000-8000-000000000010',
  'c1920000-0000-4000-8000-000000000001',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'older request', 1, 'medium', 0, 0, false, false, 'asap', 'range',
  3500, 8000
);

select pg_temp.as_user('c1920000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.submit_offer('c1920000-0000-4000-8000-000000000010', 'offer', 5000, '')$$,
  'an older request can still be offered without a pickup time'
);

select pg_temp.as_user('c1920000-0000-4000-8000-000000000001');
select lives_ok(
  $$select public.choose_offer((
    select id from public.job_offers
    where job_id = 'c1920000-0000-4000-8000-000000000010' and status = 'active'
  ))$$,
  'an older offer can still be chosen'
);
select ok(
  (select scheduled_pickup_start is null from public.jobs where id = 'c1920000-0000-4000-8000-000000000010'),
  'an older job stays without a confirmed pickup time'
);

select pg_temp.as_user('c1920000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.create_customer_request(
    'c1920000-0000-4000-8000-000000000021',
    jsonb_build_object(
      'service', 'delivery', 'description', 'Anytime dresser', 'pieces', 1, 'size', 'medium',
      'item_value_cents', 0, 'stairs_pickup', 0, 'stairs_dropoff', 0, 'elevator', false,
      'help_loading', false, 'preferred_date', 'asap', 'pricing_method', 'quote',
      'offer_cents', null, 'budget_min_cents', null, 'budget_max_cents', null,
      'zone_slug', 'west_metro', 'pickup_area', 'Austell, 30106', 'pickup_address', '1 Synthetic Lane',
      'dropoff_area', 'Smyrna, 30080', 'dropoff_address', '2 Synthetic Lane',
      'customer_name', 'Sched Customer', 'customer_phone', '+14045550192',
      'already_paid', true, 'seller_holding', false, 'wants_item_check', false,
      'pickup_availability', 'anytime', 'pickup_windows', '[]'::jsonb
    )
  )$$,
  'a customer can post an anytime request'
);

select lives_ok(
  format(
    $$select public.create_customer_request(
      'c1920000-0000-4000-8000-000000000022',
      jsonb_build_object(
        'service', 'junk', 'description', 'ASAP sofa', 'pieces', 1, 'size', 'medium',
        'item_value_cents', 0, 'stairs_pickup', 0, 'elevator', false, 'help_loading', false,
        'preferred_date', 'asap', 'pricing_method', 'quote',
        'offer_cents', null, 'budget_min_cents', null, 'budget_max_cents', null,
        'dropoff_area', null, 'dropoff_address', null, 'stairs_dropoff', null,
        'already_paid', null, 'seller_holding', null, 'wants_item_check', null,
        'zone_slug', 'west_metro', 'pickup_area', 'Austell, 30106', 'pickup_address', '3 Synthetic Lane',
        'customer_name', 'Sched Customer', 'customer_phone', '+14045550192',
        'junk_load_size', 'quarter', 'junk_materials', 'Wood furniture',
        'junk_special_items', jsonb_build_object('mattress', false, 'tires', false, 'appliances', false),
        'pickup_availability', 'asap', 'pickup_windows', '[]'::jsonb
      )
    )$$
  ),
  'a customer can post an ASAP junk request'
);

select lives_ok(
  format(
    $$select public.create_customer_request(
      'c1920000-0000-4000-8000-000000000023',
      jsonb_build_object(
        'service', 'delivery', 'description', 'One window', 'pieces', 1, 'size', 'medium',
        'item_value_cents', 0, 'stairs_pickup', 0, 'stairs_dropoff', 0, 'elevator', false,
        'help_loading', false, 'preferred_date', %L, 'time_window', 'morning', 'pricing_method', 'range',
        'offer_cents', null, 'budget_min_cents', 3500, 'budget_max_cents', 9000,
        'zone_slug', 'west_metro', 'pickup_area', 'Austell, 30106', 'pickup_address', '4 Synthetic Lane',
        'dropoff_area', 'Smyrna, 30080', 'dropoff_address', '5 Synthetic Lane',
        'customer_name', 'Sched Customer', 'customer_phone', '+14045550192',
        'already_paid', true, 'seller_holding', false, 'wants_item_check', false,
        'pickup_availability', 'windows',
        'pickup_windows', jsonb_build_array(jsonb_build_object('date', %L, 'start', '09:00', 'end', '11:00'))
      )
    )$$,
    pg_temp.day_offset(1), pg_temp.day_offset(1)
  ),
  'a customer can post one pickup window'
);

select lives_ok(
  format(
    $$select public.create_customer_request(
      'c1920000-0000-4000-8000-000000000024',
      jsonb_build_object(
        'service', 'delivery', 'description', 'Three windows', 'pieces', 1, 'size', 'medium',
        'item_value_cents', 0, 'stairs_pickup', 0, 'stairs_dropoff', 0, 'elevator', false,
        'help_loading', false, 'preferred_date', %L, 'time_window', 'morning', 'pricing_method', 'fixed',
        'offer_cents', 6500, 'budget_min_cents', null, 'budget_max_cents', null,
        'zone_slug', 'west_metro', 'pickup_area', 'Austell, 30106', 'pickup_address', '6 Synthetic Lane',
        'dropoff_area', 'Smyrna, 30080', 'dropoff_address', '7 Synthetic Lane',
        'customer_name', 'Sched Customer', 'customer_phone', '+14045550192',
        'already_paid', true, 'seller_holding', false, 'wants_item_check', false,
        'pickup_availability', 'windows',
        'pickup_windows', jsonb_build_array(
          jsonb_build_object('date', %L, 'start', '09:00', 'end', '11:00'),
          jsonb_build_object('date', %L, 'start', '13:00', 'end', '15:00'),
          jsonb_build_object('date', %L, 'start', '16:00', 'end', '18:00')
        )
      )
    )$$,
    pg_temp.day_offset(1), pg_temp.day_offset(1), pg_temp.day_offset(2), pg_temp.day_offset(3)
  ),
  'a customer can post three pickup windows'
);
select is(
  (select count(*)::int from public.job_pickup_windows where job_id = 'c1920000-0000-4000-8000-000000000024'),
  3,
  'three windows are stored'
);

select throws_ok(
  format(
    $$select public.create_customer_request(
      'c1920000-0000-4000-8000-000000000025',
      jsonb_build_object(
        'service', 'delivery', 'description', 'Too many windows', 'pieces', 1, 'size', 'medium',
        'item_value_cents', 0, 'stairs_pickup', 0, 'stairs_dropoff', 0, 'elevator', false,
        'help_loading', false, 'preferred_date', %L, 'time_window', 'morning', 'pricing_method', 'quote',
        'offer_cents', null, 'budget_min_cents', null, 'budget_max_cents', null,
        'zone_slug', 'west_metro', 'pickup_area', 'Austell, 30106', 'pickup_address', '8 Synthetic Lane',
        'dropoff_area', 'Smyrna, 30080', 'dropoff_address', '9 Synthetic Lane',
        'customer_name', 'Sched Customer', 'customer_phone', '+14045550192',
        'already_paid', true, 'seller_holding', false, 'wants_item_check', false,
        'pickup_availability', 'windows',
        'pickup_windows', jsonb_build_array(
          jsonb_build_object('date', %L, 'start', '09:00', 'end', '10:00'),
          jsonb_build_object('date', %L, 'start', '10:30', 'end', '11:30'),
          jsonb_build_object('date', %L, 'start', '12:00', 'end', '13:00'),
          jsonb_build_object('date', %L, 'start', '14:00', 'end', '15:00')
        )
      )
    )$$,
    pg_temp.day_offset(1), pg_temp.day_offset(1), pg_temp.day_offset(1), pg_temp.day_offset(1), pg_temp.day_offset(1)
  ),
  'Add between 1 and 3 pickup windows.',
  'a fourth window is rejected'
);

select pg_temp.as_user('c1920000-0000-4000-8000-000000000004');
select throws_ok(
  $$select public.apply_pickup_schedule(
    'c1920000-0000-4000-8000-000000000021',
    jsonb_build_object('pickup_availability', 'asap', 'pickup_windows', '[]'::jsonb)
  )$$,
  'only the customer can set pickup times',
  'another customer cannot change the pickup times'
);

reset role;
select pg_temp.as_user('c1920000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  format(
    $$select public.submit_offer(
      'c1920000-0000-4000-8000-000000000021', 'offer', 5000, '', null, null, null
    )$$
  ),
  'Enter the pickup date and arrival time.',
  'an anytime request needs a proposed arrival'
);
select lives_ok(
  format(
    $$select public.submit_offer(
      'c1920000-0000-4000-8000-000000000021', 'offer', 6500, '', %L, '14:00', null
    )$$,
    pg_temp.day_offset(1)
  ),
  'a driver can propose a time for an anytime request'
);
select lives_ok(
  format(
    $$select public.submit_offer(
      'c1920000-0000-4000-8000-000000000022', 'offer', 5000, '', %L, '09:30', null
    )$$,
    pg_temp.day_offset(1)
  ),
  'a driver can propose an earliest time for an ASAP request'
);

select pg_temp.as_user('c1920000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.submit_offer(
    'c1920000-0000-4000-8000-000000000023', 'offer', 4000, '', null, null,
    'c1920000-0000-4000-8000-000000000099'
  )$$,
  'Select one of the customer pickup windows.',
  'a driver cannot invent a pickup window'
);
select throws_ok(
  format(
    $$select public.submit_offer(
      'c1920000-0000-4000-8000-000000000023', 'offer', 5200, '', %L, null,
      (select id from public.job_pickup_windows where job_id = 'c1920000-0000-4000-8000-000000000023')
    )$$,
    pg_temp.day_offset(1)
  ),
  'Enter an arrival time inside the pickup window.',
  'a window arrival needs both a date and a time'
);
select throws_ok(
  format(
    $$select public.submit_offer(
      'c1920000-0000-4000-8000-000000000023', 'offer', 5300, '', %L, '08:00',
      (select id from public.job_pickup_windows where job_id = 'c1920000-0000-4000-8000-000000000023')
    )$$,
    pg_temp.day_offset(1)
  ),
  'Choose an arrival inside the pickup window.',
  'an arrival before the window is rejected'
);
select lives_ok(
  format(
    $$select public.submit_offer(
      'c1920000-0000-4000-8000-000000000023', 'offer', 5500, '', %L, '10:00',
      (select id from public.job_pickup_windows where job_id = 'c1920000-0000-4000-8000-000000000023')
    )$$,
    pg_temp.day_offset(1)
  ),
  'a driver can propose an arrival inside the customer window'
);
select lives_ok(
  format(
    $$select public.submit_offer(
      'c1920000-0000-4000-8000-000000000021', 'offer', 7000, '', %L, '10:00', null
    )$$,
    pg_temp.day_offset(2)
  ),
  'a second driver can propose a different time'
);

select pg_temp.as_user('c1920000-0000-4000-8000-000000000003');
select lives_ok(
  format(
    $$select public.submit_offer(
      'c1920000-0000-4000-8000-000000000024', 'offer', 6600, '', %L, '15:00',
      (select id from public.job_pickup_windows
       where job_id = 'c1920000-0000-4000-8000-000000000024' and position = 2)
    )$$,
    pg_temp.day_offset(2)
  ),
  'an arrival at the end of a window is allowed'
);
select pg_temp.clear_auth();
reset role;
update public.job_pickup_windows
set starts_at = now() - interval '2 hours',
    ends_at = now() - interval '1 minute'
where job_id = 'c1920000-0000-4000-8000-000000000024'
  and position = 1;
select pg_temp.as_user('c1920000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.submit_offer(
    'c1920000-0000-4000-8000-000000000024', 'accept', null, '', null, null,
    (select id from public.job_pickup_windows
     where job_id = 'c1920000-0000-4000-8000-000000000024' and position = 1)
  )$$,
  'That pickup window has passed. Choose another time.',
  'an expired window cannot be selected'
);

select pg_temp.as_user('c1920000-0000-4000-8000-000000000001');
select lives_ok(
  $$select public.choose_offer((
    select id from public.job_offers
    where job_id = 'c1920000-0000-4000-8000-000000000023' and status = 'active'
  ))$$,
  'the customer can choose the window offer'
);
select is(
  (select scheduled_pickup_end is null
    and to_char(scheduled_pickup_start at time zone 'America/New_York', 'HH24:MI') = '10:00'
    and (select count(*) from public.job_pickup_windows where job_id = 'c1920000-0000-4000-8000-000000000023') = 1
    and assigned_driver_id = 'c1920000-0000-4000-8000-000000000003'
    from public.jobs where id = 'c1920000-0000-4000-8000-000000000023'),
  true,
  'the exact arrival becomes the confirmed pickup and the window stays'
);
select throws_ok(
  $$select public.choose_offer((
    select id from public.job_offers
    where job_id = 'c1920000-0000-4000-8000-000000000023' and status = 'chosen'
  ))$$,
  'that offer is no longer available',
  'choosing the same offer again does not create a second assignment'
);
select is(
  (select count(*)::int from public.job_offers
   where job_id = 'c1920000-0000-4000-8000-000000000023' and status = 'chosen'),
  1,
  'one chosen offer is stored'
);

select pg_temp.clear_auth();
reset role;
update public.job_offers
set proposed_pickup_start = now() - interval '1 minute'
where job_id = 'c1920000-0000-4000-8000-000000000021'
  and driver_id = 'c1920000-0000-4000-8000-000000000002'
  and status = 'active';
select pg_temp.as_user('c1920000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.choose_offer((
    select id from public.job_offers
    where job_id = 'c1920000-0000-4000-8000-000000000021'
      and driver_id = 'c1920000-0000-4000-8000-000000000002'
      and status = 'active'
  ))$$,
  'That pickup time has passed. Choose another offer.',
  'an expired proposed time cannot be accepted'
);
select lives_ok(
  $$select public.choose_offer((
    select id from public.job_offers
    where job_id = 'c1920000-0000-4000-8000-000000000021'
      and driver_id = 'c1920000-0000-4000-8000-000000000003'
      and status = 'active'
  ))$$,
  'the customer can choose the other proposed time'
);
select ok(
  (select scheduled_pickup_start is not null and pickup_availability = 'anytime'
   from public.jobs where id = 'c1920000-0000-4000-8000-000000000021'),
  'the confirmed time replaces the anytime label'
);

select throws_ok(
  $$select public.request_reschedule(
    'c1920000-0000-4000-8000-000000000021',
    to_char((timezone('America/New_York', now()))::date + 1, 'YYYY-MM-DD'),
    'morning'
  )$$,
  'This pickup time is locked. Contact Pickuply support to change it.',
  'a confirmed pickup time cannot be rescheduled here'
);

select pg_temp.as_user('c1920000-0000-4000-8000-000000000002');
reset role;
select throws_ok(
  $$update public.jobs
    set scheduled_pickup_start = now() + interval '2 days'
    where id = 'c1920000-0000-4000-8000-000000000021'$$,
  'This pickup time is locked. Contact Pickuply support to change it.',
  'a driver cannot overwrite the confirmed pickup time'
);
select pg_temp.clear_auth();

select pg_temp.clear_auth();
reset role;
insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents,
  pickup_availability, pickup_timezone
) values (
  'c1920000-0000-4000-8000-000000000030',
  'c1920000-0000-4000-8000-000000000001',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'priced quote', 1, 'medium', 0, 0, false, false, 'asap', 'quote',
  7240, 6000, 1000, 240,
  'anytime', 'America/New_York'
);
select pg_temp.as_user('c1920000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.claim_job('c1920000-0000-4000-8000-000000000030')$$,
  'Enter the pickup date and arrival time.',
  'a priced quote needs a pickup time when the customer chose one'
);
select lives_ok(
  format(
    $$select public.claim_job('c1920000-0000-4000-8000-000000000030', %L, '15:00', null)$$,
    pg_temp.day_offset(1)
  ),
  'claiming a priced quote saves the proposed arrival'
);

select pg_temp.clear_auth();
reset role;
select is(
  (select prosecdef from pg_proc where proname = 'guard_window_count' and pg_function_is_visible(oid)),
  true,
  'the window count check runs as its owner'
);
select is(
  (select prosecdef from pg_proc where proname = 'guard_confirmed_schedule' and pg_function_is_visible(oid)),
  true,
  'the confirmed time check runs as its owner'
);
select is(
  (select prosecdef from pg_proc where proname = 'guard_pickup_windows' and pg_function_is_visible(oid)),
  true,
  'the window lock runs as its owner'
);
select is(
  (select prosecdef from pg_proc where proname = 'guard_offer_schedule' and pg_function_is_visible(oid)),
  true,
  'the offer time lock runs as its owner'
);

select throws_ok(
  $$select public.pickup_instant('2026-03-08', '02:30')$$,
  'That time does not exist in the pickup time zone.',
  'a skipped daylight-saving hour is rejected'
);
select is(
  to_char(public.pickup_instant('2026-11-01', '01:30') at time zone 'America/New_York', 'YYYY-MM-DD HH24:MI'),
  '2026-11-01 01:30',
  'the repeated daylight-saving hour keeps the requested wall clock'
);
select is(
  public.pickup_instant('2026-10-27', '18:00'),
  timestamptz '2026-10-27 22:00:00+00',
  'an October evening clock is Eastern Daylight Time'
);
select is(
  public.pickup_instant('2026-01-15', '18:00'),
  timestamptz '2026-01-15 23:00:00+00',
  'a January evening clock is Eastern Standard Time'
);
select is(
  public.pickup_instant('2026-10-27', '23:30'),
  timestamptz '2026-10-28 03:30:00+00',
  'a near-midnight clock stays on the Georgia calendar date'
);

create or replace function pg_temp.short_window()
returns table(day text, start_clock text, end_clock text)
language plpgsql as $$
declare
  local_now timestamp := timezone('America/New_York', now());
  end_local timestamp := local_now + interval '30 minutes';
  start_local timestamp := local_now - interval '30 minutes';
begin
  if end_local::date <> local_now::date then
    end_local := date_trunc('day', local_now) + interval '23 hours 59 minutes';
    start_local := date_trunc('day', local_now) + interval '23 hours';
  elsif start_local::date <> local_now::date then
    start_local := date_trunc('day', local_now);
  end if;
  if end_local <= local_now or end_local <= start_local or end_local >= local_now + interval '60 minutes' then
    raise exception 'could not build a short pickup window for this clock';
  end if;
  day := to_char(end_local, 'YYYY-MM-DD');
  start_clock := to_char(start_local, 'HH24:MI');
  end_clock := to_char(end_local, 'HH24:MI');
  return next;
end;
$$;

select pg_temp.as_user('c1920000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format(
    $$select public.create_customer_request(
      'c1920000-0000-4000-8000-000000000032',
      jsonb_build_object(
        'service', 'junk', 'description', 'Too soon', 'pieces', 1, 'size', 'medium',
        'item_value_cents', 0, 'stairs_pickup', 0, 'elevator', false, 'help_loading', false,
        'preferred_date', %L, 'time_window', 'evening', 'pricing_method', 'quote',
        'offer_cents', null, 'budget_min_cents', null, 'budget_max_cents', null,
        'dropoff_area', null, 'dropoff_address', null, 'stairs_dropoff', null,
        'already_paid', null, 'seller_holding', null, 'wants_item_check', null,
        'zone_slug', 'west_metro', 'pickup_area', 'Austell, 30106', 'pickup_address', '32 Synthetic Lane',
        'customer_name', 'Sched Customer', 'customer_phone', '+14045550192',
        'junk_load_size', 'quarter', 'junk_materials', 'Wood',
        'junk_special_items', jsonb_build_object('mattress', false, 'tires', false, 'appliances', false),
        'pickup_availability', 'windows',
        'pickup_windows', jsonb_build_array(jsonb_build_object('date', %L, 'start', %L, 'end', %L))
      )
    )$$,
    (select day from pg_temp.short_window()),
    (select day from pg_temp.short_window()),
    (select start_clock from pg_temp.short_window()),
    (select end_clock from pg_temp.short_window())
  ),
  'The pickup window has to end at least 60 minutes from now.',
  'a customer window must end at least 60 minutes from now'
);

select pg_temp.clear_auth();
reset role;
insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, time_window,
  pricing_method, budget_min_cents, budget_max_cents, pickup_availability, pickup_timezone
) values (
  'c1920000-0000-4000-8000-000000000033',
  'c1920000-0000-4000-8000-000000000001',
  'junk', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'window still open', 1, 'medium', 0, 0, false, false,
  pg_temp.day_offset(0), 'evening', 'range', 5000, 9000,
  'windows', 'America/New_York'
);
insert into public.job_pickup_windows (id, job_id, starts_at, ends_at, position)
values (
  'c1920000-0000-4000-8000-000000000133',
  'c1920000-0000-4000-8000-000000000033',
  now() - interval '10 minutes',
  now() + interval '30 minutes',
  1
);
select pg_temp.as_user('c1920000-0000-4000-8000-000000000002');
set local role authenticated;
select lives_ok(
  format(
    $$select public.submit_offer(
      'c1920000-0000-4000-8000-000000000033', 'offer', 6000, '', %L, %L,
      'c1920000-0000-4000-8000-000000000133'
    )$$,
    to_char((now() + interval '15 minutes') at time zone 'America/New_York', 'YYYY-MM-DD'),
    to_char((now() + interval '15 minutes') at time zone 'America/New_York', 'HH24:MI')
  ),
  'a driver can propose an arrival inside a window that is still open'
);
select is(
  (select accept_window_lead_minutes from public.platform_settings where id = 1),
  60,
  'accepting a window requires 60 minutes left by default'
);
select is(
  (select offer_arrival_lead_minutes from public.platform_settings where id = 1),
  30,
  'an Anytime or ASAP arrival requires 30 minutes by default'
);
select pg_temp.as_user('c1920000-0000-4000-8000-000000000001');
select throws_ok(
  format(
    $$select public.choose_offer(%L::uuid)$$,
    (select id from public.job_offers where job_id = 'c1920000-0000-4000-8000-000000000033' and status = 'active')
  ),
  'This time has passed. Choose another offer.',
  'a window with 30 minutes left cannot be accepted'
);
select pg_temp.clear_auth();
reset role;
update public.platform_settings set accept_window_lead_minutes = 20 where id = 1;
select pg_temp.as_user('c1920000-0000-4000-8000-000000000001');
select lives_ok(
  format(
    $$select public.choose_offer(%L::uuid)$$,
    (select id from public.job_offers where job_id = 'c1920000-0000-4000-8000-000000000033' and status = 'active')
  ),
  'lowering the accept setting lets that same window be chosen'
);
select pg_temp.as_user('c1920000-0000-4000-8000-000000000001');
select lives_ok(
  $$select public.create_customer_request(
    'c1920000-0000-4000-8000-000000000034',
    jsonb_build_object(
      'service', 'delivery', 'description', 'Soon arrival', 'pieces', 1, 'size', 'medium',
      'item_value_cents', 0, 'stairs_pickup', 0, 'stairs_dropoff', 0, 'elevator', false,
      'help_loading', false, 'preferred_date', 'asap', 'pricing_method', 'fixed',
      'offer_cents', 6500, 'budget_min_cents', null, 'budget_max_cents', null,
      'zone_slug', 'west_metro', 'pickup_area', 'Austell, 30106', 'pickup_address', '34 Synthetic Lane',
      'dropoff_area', 'Smyrna, 30080', 'dropoff_address', '35 Synthetic Lane',
      'customer_name', 'Sched Customer', 'customer_phone', '+14045550192',
      'already_paid', true, 'seller_holding', false, 'wants_item_check', false,
      'pickup_availability', 'anytime', 'pickup_windows', '[]'::jsonb
    )
  )$$,
  'an anytime request still needs no customer window'
);
select pg_temp.as_user('c1920000-0000-4000-8000-000000000002');
select throws_ok(
  format(
    $$select public.submit_offer(
      'c1920000-0000-4000-8000-000000000034', 'offer', 7000, '', %L, %L, null
    )$$,
    to_char((now() + interval '10 minutes') at time zone 'America/New_York', 'YYYY-MM-DD'),
    to_char((now() + interval '10 minutes') at time zone 'America/New_York', 'HH24:MI')
  ),
  'Choose an arrival at least 30 minutes from now.',
  'an Anytime arrival ten minutes out is rejected'
);
select lives_ok(
  format(
    $$select public.submit_offer(
      'c1920000-0000-4000-8000-000000000034', 'offer', 7000, '', %L, %L, null
    )$$,
    to_char((now() + interval '45 minutes') at time zone 'America/New_York', 'YYYY-MM-DD'),
    to_char((now() + interval '45 minutes') at time zone 'America/New_York', 'HH24:MI')
  ),
  'an Anytime arrival 45 minutes out is accepted'
);

select pg_temp.as_user('c1920000-0000-4000-8000-000000000001');
select lives_ok(
  format(
    $$select public.create_customer_request(
      'c1920000-0000-4000-8000-000000000035',
      jsonb_build_object(
        'service', 'junk', 'description', 'Current app window', 'pieces', 1, 'size', 'medium',
        'item_value_cents', 0, 'stairs_pickup', 0, 'elevator', false, 'help_loading', false,
        'preferred_date', %L, 'time_window', 'afternoon', 'pricing_method', 'fixed',
        'offer_cents', 6500, 'budget_min_cents', null, 'budget_max_cents', null,
        'zone_slug', 'west_metro', 'pickup_area', 'Austell, 30106', 'pickup_address', '35 Synthetic Lane',
        'customer_name', 'Sched Customer', 'customer_phone', '+14045550192',
        'junk_load_size', 'quarter', 'junk_materials', 'Wood furniture',
        'junk_special_items', jsonb_build_object('mattress', false, 'tires', false, 'appliances', false),
        'pickup_availability', 'windows',
        'pickup_windows', jsonb_build_array(jsonb_build_object('date', %L, 'start', '13:00', 'end', '16:00'))
      )
    )$$,
    pg_temp.day_offset(1), pg_temp.day_offset(1)
  ),
  'a window request for the current app'
);
select pg_temp.as_user('c1920000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.submit_offer(
    'c1920000-0000-4000-8000-000000000035', 'offer', 6800, '', null, null,
    (select id from public.job_pickup_windows where job_id = 'c1920000-0000-4000-8000-000000000035')
  )$$,
  'the current app can offer a window without an arrival time'
);
select is(
  (select o.proposed_pickup_start = w.starts_at and o.proposed_pickup_end = w.ends_at
   from public.job_offers o
   join public.job_pickup_windows w on w.id = o.pickup_window_id
   where o.job_id = 'c1920000-0000-4000-8000-000000000035' and o.status = 'active'),
  true,
  'a window offer without an arrival stores the whole window'
);
select pg_temp.as_user('c1920000-0000-4000-8000-000000000001');
select lives_ok(
  $$select public.choose_offer((
    select id from public.job_offers
    where job_id = 'c1920000-0000-4000-8000-000000000035' and status = 'active'
  ))$$,
  'the customer can accept that whole-window offer'
);
select is(
  (select scheduled_pickup_start = (
      select starts_at from public.job_pickup_windows
      where job_id = 'c1920000-0000-4000-8000-000000000035'
    )
    and scheduled_pickup_end = (
      select ends_at from public.job_pickup_windows
      where job_id = 'c1920000-0000-4000-8000-000000000035'
    )
    from public.jobs where id = 'c1920000-0000-4000-8000-000000000035'),
  true,
  'accepting a current-app window locks that window'
);
select pg_temp.as_user('c1920000-0000-4000-8000-000000000002');
select throws_ok(
  format(
    $$select public.submit_offer(
      'c1920000-0000-4000-8000-000000000024', 'offer', 6700, '', null, %L,
      (select id from public.job_pickup_windows
       where job_id = 'c1920000-0000-4000-8000-000000000024' and position = 3)
    )$$,
    '17:00'
  ),
  'Enter an arrival time inside the pickup window.',
  'an arrival time without its date is rejected'
);

select * from finish();
rollback;
