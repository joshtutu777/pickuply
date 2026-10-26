-- Local only. Review backfill, expired-review close, and junk disposal receipts.

begin;

select plan(14);

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
select pg_temp.make_user('c1830000-0000-4000-8000-000000000001', 'back-customer@pickuply.test');
select pg_temp.make_user('c1830000-0000-4000-8000-000000000002', 'back-driver@pickuply.test');
update public.profiles set full_name = 'Casey Customer', phone = '5555550191' where id = 'c1830000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'Pat Driver', phone = '5555550192' where id = 'c1830000-0000-4000-8000-000000000002';
insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online, license_url)
values (
  'c1830000-0000-4000-8000-000000000002', 'active',
  (select id from public.zones where slug = 'west_metro'),
  'full', array['delivery', 'junk']::public.job_service[], true,
  'c1830000-0000-4000-8000-000000000002/license.jpg'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values
  ('c1830000-0000-4000-8000-000000000011', 'c1830000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'expired', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1830000-0000-4000-8000-000000000012', 'c1830000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'waiting', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1830000-0000-4000-8000-000000000014', 'c1830000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'backfill', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1830000-0000-4000-8000-000000000015', 'c1830000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'ambiguous', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1830000-0000-4000-8000-000000000016', 'c1830000-0000-4000-8000-000000000001', 'junk', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'disposal', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1830000-0000-4000-8000-000000000017', 'c1830000-0000-4000-8000-000000000001', 'junk', 'open', (select id from public.zones where slug = 'west_metro'), 'Austell 30168', 'no disposal', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000);

select set_config('pickuply.system_payment', 'yes', true);
update public.jobs
set status = 'assigned',
    assigned_driver_id = 'c1830000-0000-4000-8000-000000000002',
    payment_status = 'authorized',
    price_cents = 5150
where id in (
  'c1830000-0000-4000-8000-000000000011',
  'c1830000-0000-4000-8000-000000000012',
  'c1830000-0000-4000-8000-000000000014',
  'c1830000-0000-4000-8000-000000000015',
  'c1830000-0000-4000-8000-000000000016',
  'c1830000-0000-4000-8000-000000000017'
);
update public.jobs set dump_fee_cents = 4500 where id = 'c1830000-0000-4000-8000-000000000016';
select set_config('pickuply.system_payment', 'no', true);

select pg_temp.as_user('c1830000-0000-4000-8000-000000000002');
set local role authenticated;
select public.advance_job('c1830000-0000-4000-8000-000000000011', 'en_route');
select public.advance_job('c1830000-0000-4000-8000-000000000011', 'arrived');
select public.record_proof('c1830000-0000-4000-8000-000000000011', 'pickup', 'c1830000-0000-4000-8000-000000000011/pickup/c1830000-0000-4000-8000-000000000021.jpg', '', 'photo', false, null, null);
select public.advance_job('c1830000-0000-4000-8000-000000000011', 'item_check');
select public.advance_job('c1830000-0000-4000-8000-000000000012', 'en_route');
select public.advance_job('c1830000-0000-4000-8000-000000000012', 'arrived');
select public.record_proof('c1830000-0000-4000-8000-000000000012', 'pickup', 'c1830000-0000-4000-8000-000000000012/pickup/c1830000-0000-4000-8000-000000000022.jpg', '', 'photo', false, null, null);
select public.advance_job('c1830000-0000-4000-8000-000000000012', 'item_check');

reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
update public.jobs set pickup_review_until = now() - interval '1 minute' where id = 'c1830000-0000-4000-8000-000000000011';

select pg_temp.as_user('c1830000-0000-4000-8000-000000000002');
set local role authenticated;
select lives_ok(
  $$select public.advance_job('c1830000-0000-4000-8000-000000000011', 'at_dropoff')$$,
  'the next driver action closes an expired pickup review'
);
select is(
  (select status::text || '|' || pickup_review_result || '|' || (dropoff_arrived_at is not null)::text
   from public.jobs where id = 'c1830000-0000-4000-8000-000000000011'),
  'in_transit|timeout|true',
  'the expired review is closed and the drop-off arrival is recorded'
);
select throws_ok(
  $$select public.advance_job('c1830000-0000-4000-8000-000000000012', 'at_dropoff')$$,
  'that step is not available',
  'a review that is still open does not close early'
);

reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
insert into public.job_reports (id, job_id, reporter_id, category, description, outcome_wanted)
values (
  'c1830000-0000-4000-8000-000000000031',
  'c1830000-0000-4000-8000-000000000012',
  'c1830000-0000-4000-8000-000000000001',
  'other', 'The item is cracked.', 'note'
);
insert into public.job_disputes (job_id, report_id, capture_hold, payout_hold)
values ('c1830000-0000-4000-8000-000000000012', 'c1830000-0000-4000-8000-000000000031', true, true);
update public.jobs set pickup_review_until = now() - interval '1 minute' where id = 'c1830000-0000-4000-8000-000000000012';
select pg_temp.as_user('c1830000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.advance_job('c1830000-0000-4000-8000-000000000012', 'at_dropoff')$$,
  'that step is not available',
  'an open problem still blocks the next step'
);
select is(
  (select status::text from public.jobs where id = 'c1830000-0000-4000-8000-000000000012'),
  'item_check',
  'the disputed review stays where it is'
);

reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('pickuply.system_payment', 'yes', true);
update public.jobs
set status = 'in_transit', dropoff_arrived_at = now(), payment_status = 'authorized'
where id in ('c1830000-0000-4000-8000-000000000016', 'c1830000-0000-4000-8000-000000000017');
select set_config('pickuply.system_payment', 'no', true);
select pg_temp.as_user('c1830000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.advance_job('c1830000-0000-4000-8000-000000000016', 'delivered')$$,
  'add the delivery photo first',
  'a disposal job still needs the drop-off photo'
);
select public.record_proof('c1830000-0000-4000-8000-000000000016', 'dropoff', 'c1830000-0000-4000-8000-000000000016/dropoff/c1830000-0000-4000-8000-000000000026.jpg', '', 'photo', false, null, null);
select throws_ok(
  $$select public.advance_job('c1830000-0000-4000-8000-000000000016', 'delivered')$$,
  'add the disposal receipt first',
  'a junk job with a dump fee needs a disposal receipt'
);
select public.record_proof('c1830000-0000-4000-8000-000000000016', 'dump_receipt', 'c1830000-0000-4000-8000-000000000016/dump_receipt/c1830000-0000-4000-8000-000000000036.jpg', '', 'photo', false, null, null);
select lives_ok(
  $$select public.advance_job('c1830000-0000-4000-8000-000000000016', 'delivered')$$,
  'delivery succeeds after the drop-off photo and the disposal receipt'
);
select public.record_proof('c1830000-0000-4000-8000-000000000017', 'dropoff', 'c1830000-0000-4000-8000-000000000017/dropoff/c1830000-0000-4000-8000-000000000027.jpg', '', 'photo', false, null, null);
select lives_ok(
  $$select public.advance_job('c1830000-0000-4000-8000-000000000017', 'delivered')$$,
  'a junk job that is not a disposal does not need a receipt'
);

reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('pickuply.system_payment', 'yes', true);
update public.jobs
set status = 'item_check',
    assigned_driver_id = 'c1830000-0000-4000-8000-000000000002',
    payment_status = 'authorized',
    pickup_review_until = null
where id = 'c1830000-0000-4000-8000-000000000014';
update public.jobs
set status = 'item_check',
    assigned_driver_id = 'c1830000-0000-4000-8000-000000000002',
    payment_status = 'authorized'
where id = 'c1830000-0000-4000-8000-000000000015';
select set_config('pickuply.system_payment', 'no', true);
select pg_temp.as_user('c1830000-0000-4000-8000-000000000002');
set local role authenticated;
select public.record_proof('c1830000-0000-4000-8000-000000000014', 'pickup', 'c1830000-0000-4000-8000-000000000014/pickup/c1830000-0000-4000-8000-000000000024.jpg', '', 'photo', false, null, null);
reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
select is(public.apply_pickup_review_backfill(), 1, 'an eligible review gets one deadline');
select is(
  (select pickup_review_until = (
      select min(created_at) + interval '10 minutes'
      from public.job_events
      where job_id = 'c1830000-0000-4000-8000-000000000014'
        and type = 'status' and data->>'to' = 'item_check'
    )
   from public.jobs where id = 'c1830000-0000-4000-8000-000000000014'),
  true,
  'the deadline comes from the pickup event'
);
select is(public.apply_pickup_review_backfill(), 0, 'running the backfill again changes nothing');
select is(
  (select action || '|' || reason from public.pickup_review_backfill where job_id = 'c1830000-0000-4000-8000-000000000015'),
  'ambiguous|missing_pickup_photo',
  'a review without a pickup photo is flagged and not scheduled'
);
select is(
  (select pickup_review_until is null from public.jobs where id = 'c1830000-0000-4000-8000-000000000015'),
  true,
  'an ambiguous review does not get a deadline'
);

select * from finish();
rollback;
