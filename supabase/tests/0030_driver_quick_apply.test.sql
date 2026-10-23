-- Quick Apply approval does not unlock jobs until the checklist is done.

begin;

set local search_path to public, extensions;

select plan(11);

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

select pg_temp.make_user('d3000000-0000-4000-8000-000000000001', 'quick-driver@pickuply.test');
select pg_temp.make_user('d3000000-0000-4000-8000-000000000002', 'quick-admin@pickuply.test');
select pg_temp.make_user('d3000000-0000-4000-8000-000000000003', 'quick-customer@pickuply.test');
update public.profiles set role = 'admin', full_name = 'Quick Admin' where id = 'd3000000-0000-4000-8000-000000000002';
update public.profiles set full_name = 'Quick Customer' where id = 'd3000000-0000-4000-8000-000000000003';

select set_config('pickuply.quote_accepted', 'yes', true);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
  item_value_cents, stairs_pickup, stairs_dropoff, elevator, help_loading, preferred_date,
  pricing_method, offer_cents, service_level, required_vehicle
) values (
  'd3000000-0000-4000-8000-000000000010',
  'd3000000-0000-4000-8000-000000000003',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell, 30106', 'Smyrna, 30080', 'Checklist desk', 1, 'medium',
  0, 0, 0, false, false, 'asap',
  'quote', null, 'light', 'pickup'
);

select pg_temp.as_user('d3000000-0000-4000-8000-000000000001');
select lives_ok(
  $$select public.submit_quick_application(jsonb_build_object(
    'full_name', 'Quick Driver',
    'home_city', 'Austell',
    'zone_id', (select id from public.zones where slug = 'west_metro'),
    'service_level', 'light',
    'vehicle_type', 'pickup',
    'photo_path', 'd3000000-0000-4000-8000-000000000001/profile.jpg',
    'license_path', 'd3000000-0000-4000-8000-000000000001/license.jpg',
    'license_expires', '2027-12-31',
    'contact_ok', 'true'
  ))$$,
  'a short application can be submitted'
);

select pg_temp.as_user('d3000000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.review_driver(
    'd3000000-0000-4000-8000-000000000001',
    'approve_active',
    ''
  )$$,
  'an admin can approve the short application'
);

select is(
  (select approved from public.vehicles where driver_id = 'd3000000-0000-4000-8000-000000000001'),
  false,
  'approval does not approve the vehicle by itself'
);

select pg_temp.as_user('d3000000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.set_driver_online(true)$$,
  'Add your insurance card before going Online.',
  'an approved quick applicant cannot go online yet'
);
select is(
  (select count(*)::int from public.driver_job_feed()),
  0,
  'an unfinished checklist hides invited and open jobs'
);
select throws_ok(
  $$select public.claim_job('d3000000-0000-4000-8000-000000000010')$$,
  'go online before claiming a job',
  'a quick applicant cannot claim before going online'
);
select throws_ok(
  $$select public.submit_offer('d3000000-0000-4000-8000-000000000010', 'accept', null, '')$$,
  'go online before sending an offer',
  'a quick applicant cannot offer before going online'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select set_config('role', 'postgres', true);
update public.drivers
set is_online = true
where profile_id = 'd3000000-0000-4000-8000-000000000001';
select pg_temp.as_user('d3000000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.claim_job('d3000000-0000-4000-8000-000000000010')$$,
  'this driver cannot claim this job',
  'an unfinished checklist cannot claim even when marked online'
);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select set_config('role', 'postgres', true);
update public.drivers
set is_online = false
where profile_id = 'd3000000-0000-4000-8000-000000000001';

select pg_temp.as_user('d3000000-0000-4000-8000-000000000001');
select public.save_driver_insurance('d3000000-0000-4000-8000-000000000001/insurance.jpg', '2027-12-31'::date);
select public.save_driver_vehicle('Ford', 'F150', 2018, 'TEST123', 72, 'd3000000-0000-4000-8000-000000000001/vehicle.jpg');
select public.save_driver_kit(array['blankets'], '', '');
select public.save_driver_services(array['delivery'], 'light');
select public.sign_driver_agreement('Quick Driver');
select public.complete_driver_training();
select pg_temp.as_user('d3000000-0000-4000-8000-000000000002');
select public.approve_driver_vehicle('d3000000-0000-4000-8000-000000000001');

select pg_temp.as_user('d3000000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.claim_job('d3000000-0000-4000-8000-000000000010')$$,
  'go online before claiming a job',
  'a finished checklist still cannot claim while offline'
);
select lives_ok(
  $$select public.set_driver_online(true)$$,
  'a finished checklist can go online'
);
select lives_ok(
  $$select public.claim_job('d3000000-0000-4000-8000-000000000010')$$,
  'a finished checklist can claim one open job'
);

select * from finish();
rollback;
