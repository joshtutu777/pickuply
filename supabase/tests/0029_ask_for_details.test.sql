-- Local only. A published request stays open when an admin asks for details.
-- Pause until updated is optional. An update tells drivers who already offered.

begin;

set local search_path to public, extensions;

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

select pg_temp.make_user('d2900000-0000-4000-8000-000000000001', 'details-customer@pickuply.test');
select pg_temp.make_user('d2900000-0000-4000-8000-000000000002', 'details-admin@pickuply.test');
select pg_temp.make_user('d2900000-0000-4000-8000-000000000003', 'details-other@pickuply.test');
update public.profiles set role = 'admin', full_name = 'Details Admin' where id = 'd2900000-0000-4000-8000-000000000002';
update public.profiles set full_name = 'Details Customer' where id = 'd2900000-0000-4000-8000-000000000001';

select pg_temp.as_user('d2900000-0000-4000-8000-000000000001');
select public.create_customer_request(
  'd2900000-0000-4000-8000-000000000010',
  jsonb_build_object(
    'service', 'delivery',
    'description', 'Oak dresser',
    'has_photo', false,
    'pricing_method', 'quote',
    'preferred_date', 'asap',
    'zone_slug', 'west_metro',
    'pickup_area', 'Austell, 30106',
    'pickup_address', '10 Secret Street',
    'dropoff_area', 'Smyrna, 30080',
    'dropoff_address', '20 Hidden Avenue',
    'customer_name', 'Details Customer',
    'customer_phone', '+14045551212',
    'stairs_pickup', 0,
    'stairs_dropoff', 0,
    'elevator', false,
    'help_loading', false,
    'offer_cents', null,
    'budget_min_cents', null,
    'budget_max_cents', null,
    'pieces', null,
    'size', null,
    'item_value_cents', null,
    'listing_url', null,
    'notes', null,
    'source', null,
    'customer_email', null,
    'access_notes', null,
    'already_paid', null,
    'seller_holding', null,
    'wants_item_check', null,
    'junk_load_size', null,
    'junk_materials', null,
    'junk_special_items', null,
    'store_name', null,
    'store_order_number', null
  )
);

select pg_temp.as_user('d2900000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.ask_for_details(
    'd2900000-0000-4000-8000-000000000010',
    array['size'],
    'How big is it?'
  )$$,
  'only an admin can ask for details',
  'a customer cannot ask for details'
);

select pg_temp.as_user('d2900000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.ask_for_details(
    'd2900000-0000-4000-8000-000000000010',
    array['size', 'photos'],
    'How big is it?'
  )$$,
  'an admin can ask for size and a photo'
);

select is(
  (select status from public.jobs where id = 'd2900000-0000-4000-8000-000000000010'),
  'open',
  'asking for details leaves an open quote on the driver list'
);

select ok(
  (select paused_at is null from public.jobs where id = 'd2900000-0000-4000-8000-000000000010'),
  'asking for details does not pause unless the admin chooses it'
);

select is(
  (
    select messages.action_href
    from public.messages
    join public.message_threads on message_threads.id = messages.thread_id
    where message_threads.kind = 'support'
      and message_threads.requester_id = 'd2900000-0000-4000-8000-000000000001'
    order by messages.created_at desc
    limit 1
  ),
  '/jobs/d2900000-0000-4000-8000-000000000010/edit',
  'the support message opens the edit form'
);

select is(
  (
    select href
    from public.notifications
    where profile_id = 'd2900000-0000-4000-8000-000000000001'
      and kind = 'details_requested'
    order by created_at desc
    limit 1
  ),
  '/jobs/d2900000-0000-4000-8000-000000000010/edit',
  'the alert opens the edit form'
);

select ok(
  (select detail_request->>'answered_at' is null from public.jobs where id = 'd2900000-0000-4000-8000-000000000010'),
  'the question stays open'
);

select throws_ok(
  $$update public.jobs set status = 'quoted' where id = 'd2900000-0000-4000-8000-000000000010'$$,
  'wait for the customer to answer before quoting or publishing',
  'an admin quote waits for the answer'
);

select pg_temp.as_user('d2900000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.answer_detail_request(
    'd2900000-0000-4000-8000-000000000010',
    '{"size":"medium"}'::jsonb,
    'It is medium.'
  )$$,
  'only the customer can answer',
  'another person cannot answer'
);

select pg_temp.as_user('d2900000-0000-4000-8000-000000000001');
select lives_ok(
  $$select public.answer_detail_request(
    'd2900000-0000-4000-8000-000000000010',
    '{"size":"medium"}'::jsonb,
    'It is a medium dresser.'
  )$$,
  'the customer can answer'
);

select is(
  (
    select status || ':' || size::text
    from public.jobs
    where id = 'd2900000-0000-4000-8000-000000000010'
      and detail_request->>'answered_at' is not null
  ),
  'open:medium',
  'an answered quote stays open for driver offers'
);

select is(
  (
    select count(*)::int
    from public.notifications
    where job_id = 'd2900000-0000-4000-8000-000000000010'
      and kind = 'request_updated'
  ),
  0,
  'an update with no offers does not alert a driver'
);

select pg_temp.as_user('d2900000-0000-4000-8000-000000000001');
select public.create_customer_request(
  'd2900000-0000-4000-8000-000000000011',
  jsonb_build_object(
    'service', 'delivery',
    'description', 'Oak table',
    'has_photo', false,
    'pricing_method', 'fixed',
    'preferred_date', 'asap',
    'zone_slug', 'west_metro',
    'pickup_area', 'Austell, 30106',
    'pickup_address', '11 Secret Street',
    'dropoff_area', 'Smyrna, 30080',
    'dropoff_address', '21 Hidden Avenue',
    'customer_name', 'Details Customer',
    'customer_phone', '+14045551212',
    'stairs_pickup', 0,
    'stairs_dropoff', 0,
    'elevator', false,
    'help_loading', false,
    'offer_cents', 5000,
    'budget_min_cents', null,
    'budget_max_cents', null,
    'pieces', null,
    'size', null,
    'item_value_cents', null,
    'listing_url', null,
    'notes', null,
    'source', null,
    'customer_email', null,
    'access_notes', null,
    'already_paid', null,
    'seller_holding', null,
    'wants_item_check', null,
    'junk_load_size', null,
    'junk_materials', null,
    'junk_special_items', null,
    'store_name', null,
    'store_order_number', null
  )
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);

select pg_temp.make_user('d2900000-0000-4000-8000-000000000004', 'details-driver@pickuply.test');
update public.profiles
set role = 'driver', full_name = 'Details Driver'
where id = 'd2900000-0000-4000-8000-000000000004';
insert into public.drivers (
  profile_id, status, zone_id, home_city, service_level, services, is_online
) values (
  'd2900000-0000-4000-8000-000000000004',
  'active',
  (select id from public.zones where slug = 'west_metro'),
  'Austell',
  'light',
  array['delivery']::public.job_service[],
  true
);
select pg_temp.as_user('d2900000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.ask_for_details(
    'd2900000-0000-4000-8000-000000000011',
    array['size'],
    'How big is the table?',
    false
  )$$,
  'an admin can ask without pausing the request'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select lives_ok(
  $$insert into public.job_offers (
    job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents,
    customer_total_cents, outside_range, status, expires_at
  ) values (
    'd2900000-0000-4000-8000-000000000011',
    'd2900000-0000-4000-8000-000000000004',
    'accept',
    5000,
    0,
    0,
    5000,
    false,
    'active',
    now() + interval '2 hours'
  )$$,
  'a driver can send an offer while the question is open'
);

select ok(
  (
    select detail_request->>'answered_at' is null
      and exists (
        select 1 from public.job_offers
        where job_id = 'd2900000-0000-4000-8000-000000000011'
          and status = 'active'
      )
    from public.jobs
    where id = 'd2900000-0000-4000-8000-000000000011'
      and paused_at is null
  ),
  'the open question keeps the request visible to drivers'
);

select pg_temp.as_user('d2900000-0000-4000-8000-000000000004');
select is(
  (
    select count(*)::int
    from public.driver_job_feed()
    where id = 'd2900000-0000-4000-8000-000000000011'
  ),
  1,
  'the driver feed still shows a request that was not paused'
);

select pg_temp.as_user('d2900000-0000-4000-8000-000000000001');
select lives_ok(
  $$select public.answer_detail_request(
    'd2900000-0000-4000-8000-000000000011',
    '{"size":"large"}'::jsonb,
    'It is a large table.'
  )$$,
  'the customer update publishes the paused request again'
);

select ok(
  (
    select status = 'open' and paused_at is null and size::text = 'large'
    from public.jobs
    where id = 'd2900000-0000-4000-8000-000000000011'
  ),
  'the updated request is visible again at the same price'
);

select is(
  (
    select title
    from public.notifications
    where profile_id = 'd2900000-0000-4000-8000-000000000004'
      and job_id = 'd2900000-0000-4000-8000-000000000011'
      and kind = 'request_updated'
    limit 1
  ),
  'Request updated — review your offer',
  'a driver who already offered is told to review the offer'
);

select pg_temp.as_user('d2900000-0000-4000-8000-000000000001');
select public.create_customer_request(
  'd2900000-0000-4000-8000-000000000012',
  jsonb_build_object(
    'service', 'delivery',
    'description', 'Oak chair',
    'has_photo', false,
    'pricing_method', 'fixed',
    'preferred_date', 'asap',
    'zone_slug', 'west_metro',
    'pickup_area', 'Austell, 30106',
    'pickup_address', '12 Secret Street',
    'dropoff_area', 'Smyrna, 30080',
    'dropoff_address', '22 Hidden Avenue',
    'customer_name', 'Details Customer',
    'customer_phone', '+14045551212',
    'stairs_pickup', 0,
    'stairs_dropoff', 0,
    'elevator', false,
    'help_loading', false,
    'offer_cents', 5000,
    'budget_min_cents', null,
    'budget_max_cents', null,
    'pieces', null,
    'size', null,
    'item_value_cents', null,
    'listing_url', null,
    'notes', null,
    'source', null,
    'customer_email', null,
    'access_notes', null,
    'already_paid', null,
    'seller_holding', null,
    'wants_item_check', null,
    'junk_load_size', null,
    'junk_materials', null,
    'junk_special_items', null,
    'store_name', null,
    'store_order_number', null
  )
);

select pg_temp.as_user('d2900000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.ask_for_details(
    'd2900000-0000-4000-8000-000000000012',
    array['size'],
    'How big is the chair?',
    true
  )$$,
  'an admin can pause a published request until it is updated'
);

select pg_temp.as_user('d2900000-0000-4000-8000-000000000004');
select is(
  (
    select count(*)::int
    from public.driver_job_feed()
    where id = 'd2900000-0000-4000-8000-000000000012'
  ),
  0,
  'a paused request is hidden from the driver feed'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$insert into public.job_offers (
    job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents,
    customer_total_cents, outside_range, status, expires_at
  ) values (
    'd2900000-0000-4000-8000-000000000012',
    'd2900000-0000-4000-8000-000000000004',
    'accept',
    5000,
    0,
    0,
    5000,
    false,
    'active',
    now() + interval '2 hours'
  )$$,
  'this request is paused',
  'a paused request rejects a new offer'
);

select * from finish();
rollback;
