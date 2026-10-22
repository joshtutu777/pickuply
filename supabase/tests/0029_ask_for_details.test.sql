-- Local only. Asking for details blocks a quote until the customer answers.

begin;

set local search_path to public, extensions;

select plan(8);

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
  'in_review',
  'the request waits in review'
);

select ok(
  (select detail_request->>'answered_at' is null from public.jobs where id = 'd2900000-0000-4000-8000-000000000010'),
  'the question stays open'
);

select throws_ok(
  $$update public.jobs set status = 'quoted' where id = 'd2900000-0000-4000-8000-000000000010'$$,
  'wait for the customer to answer before quoting or publishing',
  'a quote is blocked while the question is open'
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
  'requested:medium',
  'the answered request returns to the review queue with the size saved'
);

select * from finish();
rollback;
