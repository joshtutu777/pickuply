-- Local only. Junk removal finishes at the pickup. Confirmation starts after that milestone.

begin;

select plan(11);

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

create or replace function pg_temp.make_user(uid uuid, email text)
returns void language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    email, 'test-hash', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now(), now(), uid::text, '', uid::text || '-email', uid::text || '-recovery'
  );
end;
$$;

select set_config('pickuply.phone_hmac_secret', 'local-test-secret', true);

select pg_temp.make_user('c1890000-0000-4000-8000-000000000001', 'junk-customer@pickuply.test');
select pg_temp.make_user('c1890000-0000-4000-8000-000000000002', 'junk-driver@pickuply.test');

update public.profiles set full_name = 'Casey Customer', phone = '5555550191' where id = 'c1890000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'Pat Driver', phone = '5555550192' where id = 'c1890000-0000-4000-8000-000000000002';

insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online, license_url)
values (
  'c1890000-0000-4000-8000-000000000002', 'active',
  (select id from public.zones where slug = 'west_metro'),
  'full', array['junk']::public.job_service[], true,
  'c1890000-0000-4000-8000-000000000002/license.jpg'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  offer_cents, price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents,
  assigned_driver_id, payment_status, require_disposal_receipt
) values (
  'c1890000-0000-4000-8000-000000000011', 'c1890000-0000-4000-8000-000000000001',
  'junk', 'arrived', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'old couch', 1, 'medium', 0, 0, false, false, 'asap', 'fixed',
  5000, 5150, 4250, 750, 150,
  'c1890000-0000-4000-8000-000000000002', 'authorized', true
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  offer_cents, assigned_driver_id, payment_status
) values (
  'c1890000-0000-4000-8000-000000000012', 'c1890000-0000-4000-8000-000000000001',
  'delivery', 'item_check', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'still loaded', 1, 'medium', 0, 0, false, false, 'asap', 'fixed',
  5000, 'c1890000-0000-4000-8000-000000000002', 'authorized'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  offer_cents, price_cents, payment_status
) values (
  'c1890000-0000-4000-8000-000000000013', 'c1890000-0000-4000-8000-000000000001',
  'delivery', 'completed', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'already finished', 1, 'medium', 0, 0, false, false, 'asap', 'fixed',
  5000, 5150, 'captured'
);

select pg_temp.as_user('c1890000-0000-4000-8000-000000000002');
set local role authenticated;

select throws_ok(
  $$select public.advance_job('c1890000-0000-4000-8000-000000000011', 'delivered')$$,
  'add the pickup photo first',
  'junk removal needs a completion photo'
);

select lives_ok(
  $$select public.record_proof(
    'c1890000-0000-4000-8000-000000000011',
    'pickup',
    'c1890000-0000-4000-8000-000000000011/pickup/c1890000-0000-4000-8000-000000000021.jpg',
    '',
    'photo',
    false,
    null,
    null
  )$$,
  'the completion photo is stored'
);

select throws_ok(
  $$select public.advance_job('c1890000-0000-4000-8000-000000000011', 'delivered')$$,
  'add the disposal receipt first',
  'a required disposal receipt still blocks junk removed'
);

select lives_ok(
  $$select public.record_proof(
    'c1890000-0000-4000-8000-000000000011',
    'dump_receipt',
    'c1890000-0000-4000-8000-000000000011/dump_receipt/c1890000-0000-4000-8000-000000000022.jpg',
    '',
    'photo',
    false,
    null,
    null
  )$$,
  'the disposal receipt is stored'
);

select lives_ok(
  $$select public.advance_job('c1890000-0000-4000-8000-000000000011', 'delivered')$$,
  'junk removed does not need a drop-off'
);

select is(
  (select status::text || '|' || (dropoff_arrived_at is null)::text || '|' || (delivered_at is not null)::text
   from public.jobs where id = 'c1890000-0000-4000-8000-000000000011'),
  'delivered|true|true',
  'junk removed starts the confirmation clock without a drop-off'
);

reset role;
select pg_temp.as_user('c1890000-0000-4000-8000-000000000001');
set local role authenticated;

select throws_ok(
  $$select public.confirm_delivery('c1890000-0000-4000-8000-000000000012')$$,
  'this job is not delivered yet',
  'the customer cannot confirm before the service is finished'
);

select lives_ok(
  $$select public.confirm_delivery('c1890000-0000-4000-8000-000000000011')$$,
  'the customer confirms after junk is removed'
);

reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('pickuply.system_payment', 'yes', true);
insert into public.job_payments (job_id, payment_intent_id)
values ('c1890000-0000-4000-8000-000000000011', 'pi_testflow189');
select is(
  public.capture_context('c1890000-0000-4000-8000-000000000011')->>'kind',
  'full',
  'confirmation makes the existing capture eligible'
);

insert into public.job_reports (id, job_id, reporter_id, category, description, outcome_wanted)
values (
  'c1890000-0000-4000-8000-000000000031',
  'c1890000-0000-4000-8000-000000000011',
  'c1890000-0000-4000-8000-000000000001',
  'other', 'The pile is still there.', 'note'
);
insert into public.job_disputes (job_id, report_id, capture_hold, payout_hold)
values ('c1890000-0000-4000-8000-000000000011', 'c1890000-0000-4000-8000-000000000031', true, true);
select is(
  public.capture_context('c1890000-0000-4000-8000-000000000011') is null,
  true,
  'a dispute blocks capture'
);

select is(
  (select status::text from public.jobs where id = 'c1890000-0000-4000-8000-000000000013'),
  'completed',
  'a finished job keeps its status'
);

select * from finish();
rollback;
