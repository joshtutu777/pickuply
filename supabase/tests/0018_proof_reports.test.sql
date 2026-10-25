-- Local Supabase only. A report holds capture and payout and does not reverse a completed capture.

begin;

select plan(12);

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

select pg_temp.make_user('e1818181-1818-4181-8181-181818181811', 'proof-customer@pickuply.test');
select pg_temp.make_user('e1818181-1818-4181-8181-181818181812', 'proof-driver@pickuply.test');
select pg_temp.make_user('e1818181-1818-4181-8181-181818181813', 'proof-admin@pickuply.test');

update public.profiles set role = 'driver', full_name = 'Proof Driver' where id = 'e1818181-1818-4181-8181-181818181812';
update public.profiles set role = 'admin', full_name = 'Proof Admin' where id = 'e1818181-1818-4181-8181-181818181813';
update public.profiles set full_name = 'Proof Customer' where id = 'e1818181-1818-4181-8181-181818181811';

insert into public.drivers (
  profile_id, status, zone_id, service_level, services, max_distance_miles, is_online,
  license_url, license_expires, insurance_expires, insurance_url
) values (
  'e1818181-1818-4181-8181-181818181812', 'active',
  (select id from public.zones where slug = 'west_metro'),
  'full', array['delivery']::public.job_service[], 25, true,
  'e1818181-1818-4181-8181-181818181812/license.jpg', current_date + 30,
  current_date + 30, 'e1818181-1818-4181-8181-181818181812/insurance.jpg'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date,
  pricing_method, service_level, required_vehicle
) values
  (
    'e1818181-1818-4181-8181-181818181821', 'e1818181-1818-4181-8181-181818181811',
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell 30168', 'proof job', 1, 'medium', 0, 0, false, false, 'asap',
    'fixed', 'full', 'pickup'
  ),
  (
    'e1818181-1818-4181-8181-181818181822', 'e1818181-1818-4181-8181-181818181811',
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell 30168', 'hold job', 1, 'medium', 0, 0, false, false, 'asap',
    'fixed', 'full', 'pickup'
  );

update public.jobs
set status = 'assigned',
    assigned_driver_id = 'e1818181-1818-4181-8181-181818181812',
    payment_status = 'captured'
where id = 'e1818181-1818-4181-8181-181818181821';

update public.jobs
set status = 'assigned',
    assigned_driver_id = 'e1818181-1818-4181-8181-181818181812',
    payment_status = 'authorized'
where id = 'e1818181-1818-4181-8181-181818181822';

insert into public.job_photos (job_id, stage, storage_path, uploaded_by)
values (
  'e1818181-1818-4181-8181-181818181821', 'request',
  'e1818181-1818-4181-8181-181818181821/request/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
  'e1818181-1818-4181-8181-181818181811'
);

select is(
  (select pickup_max from public.proof_rules where service = 'delivery'),
  3,
  'delivery can store up to 3 pickup photos'
);

select is(
  (select pickup_max from public.proof_rules where service = 'free_item'),
  1,
  'a free-item pickup stores 1 photo'
);

select pg_temp.as_user('e1818181-1818-4181-8181-181818181811');
set local role authenticated;

select lives_ok(
  $$select public.file_job_report(
    'e1818181-1818-4181-8181-181818181821', 'other', 'The corner is cracked.', 'repair'
  )$$,
  'the customer can report a problem'
);

reset role;

select is(
  (select payment_status::text from public.jobs where id = 'e1818181-1818-4181-8181-181818181821'),
  'captured',
  'a report does not reverse a completed capture'
);

select pg_temp.as_user('e1818181-1818-4181-8181-181818181811');
set local role authenticated;

select lives_ok(
  $$select public.file_job_report(
    'e1818181-1818-4181-8181-181818181822', 'missing', 'The item was not delivered.', 'refund'
  )$$,
  'a missing item can be reported'
);

reset role;
select pg_temp.clear_auth();

select throws_ok(
  $$update public.jobs
    set payment_status = 'captured'
    where id = 'e1818181-1818-4181-8181-181818181822'$$,
  'capture is on hold while this job is disputed',
  'a dispute blocks capture'
);

select throws_ok(
  $$insert into public.payouts (job_id, driver_id, amount_cents)
    values (
      'e1818181-1818-4181-8181-181818181822',
      'e1818181-1818-4181-8181-181818181812',
      1000
    )$$,
  'payout is on hold while this job is disputed',
  'a dispute blocks a new payout'
);

select throws_ok(
  $$delete from public.job_photos
    where job_id = 'e1818181-1818-4181-8181-181818181821'$$,
  'photos cannot be changed or deleted',
  'proof and request photos cannot be deleted'
);

select pg_temp.as_user('e1818181-1818-4181-8181-181818181812');
set local role authenticated;

select lives_ok(
  $$select public.record_proof(
    'e1818181-1818-4181-8181-181818181822',
    'pickup',
    'e1818181-1818-4181-8181-181818181822/pickup/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg',
    'existing scratch',
    'photo',
    true,
    33.987,
    -84.123
  )$$,
  'the driver can save pickup proof'
);

reset role;
update public.platform_settings set proof_location_enabled = true where id = 1;

select pg_temp.as_user('e1818181-1818-4181-8181-181818181812');
set local role authenticated;

select lives_ok(
  $$select public.record_proof(
    'e1818181-1818-4181-8181-181818181822',
    'dropoff',
    'e1818181-1818-4181-8181-181818181822/dropoff/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg',
    null,
    'photo',
    true,
    33.987,
    -84.123
  )$$,
  'approximate location is stored only when the setting is on'
);

reset role;

select is(
  (select approximate_lat from public.proof_locations order by created_at desc limit 1),
  33.99,
  'location is rounded before it is stored'
);

select pg_temp.as_user('e1818181-1818-4181-8181-181818181811');
set local role authenticated;

select is_empty(
  $$select photo_id from public.proof_locations$$,
  'a customer cannot read proof location'
);

select * from finish();

rollback;
