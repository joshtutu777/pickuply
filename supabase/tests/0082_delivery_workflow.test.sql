-- Local only. Delivery steps, proof gates, review timeout, and one capture window.

begin;

select plan(28);

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

select pg_temp.make_user('c1820000-0000-4000-8000-000000000001', 'flow-customer@pickuply.test');
select pg_temp.make_user('c1820000-0000-4000-8000-000000000002', 'flow-driver@pickuply.test');
select pg_temp.make_user('c1820000-0000-4000-8000-000000000003', 'flow-other@pickuply.test');

update public.profiles set full_name = 'Casey Customer', phone = '5555550186' where id = 'c1820000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'Pat Driver', phone = '5555550187' where id = 'c1820000-0000-4000-8000-000000000002';
update public.profiles set role = 'driver', full_name = 'Other Driver', phone = '5555550188' where id = 'c1820000-0000-4000-8000-000000000003';

insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online, license_url)
values (
  'c1820000-0000-4000-8000-000000000002', 'active',
  (select id from public.zones where slug = 'west_metro'),
  'full', array['delivery']::public.job_service[], true,
  'c1820000-0000-4000-8000-000000000002/license.jpg'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  offer_cents, price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents
) values (
  'c1820000-0000-4000-8000-000000000011', 'c1820000-0000-4000-8000-000000000001',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'dresser', 1, 'medium', 0, 0, false, false, 'asap', 'fixed',
  5000, 5150, 4250, 750, 150
);

update public.jobs
set status = 'assigned',
    assigned_driver_id = 'c1820000-0000-4000-8000-000000000002',
    payment_status = 'awaiting_payment'
where id = 'c1820000-0000-4000-8000-000000000011';

select pg_temp.as_user('c1820000-0000-4000-8000-000000000002');
set local role authenticated;

select throws_ok(
  $$select public.advance_job('c1820000-0000-4000-8000-000000000011', 'en_route')$$,
  'payment must be authorized before work starts',
  'a trip cannot start before the card is authorized'
);

reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('pickuply.system_payment', 'yes', true);
update public.jobs set payment_status = 'authorized' where id = 'c1820000-0000-4000-8000-000000000011';
select set_config('pickuply.system_payment', 'no', true);
select pg_temp.as_user('c1820000-0000-4000-8000-000000000002');
set local role authenticated;

select lives_ok(
  $$select public.advance_job('c1820000-0000-4000-8000-000000000011', 'en_route')$$,
  'the assigned driver starts the trip'
);
select lives_ok(
  $$select public.advance_job('c1820000-0000-4000-8000-000000000011', 'arrived')$$,
  'the driver arrives at pickup'
);
select throws_ok(
  $$select public.advance_job('c1820000-0000-4000-8000-000000000011', 'item_check')$$,
  'add the pickup photo first',
  'pickup completion needs a pickup photo'
);

select lives_ok(
  $$select public.record_proof(
    'c1820000-0000-4000-8000-000000000011',
    'pickup',
    'c1820000-0000-4000-8000-000000000011/pickup/c1820000-0000-4000-8000-000000000021.jpg',
    '',
    'photo',
    false,
    null,
    null
  )$$,
  'the pickup photo is stored for this job'
);
select lives_ok(
  $$select public.advance_job('c1820000-0000-4000-8000-000000000011', 'item_check')$$,
  'the loaded item starts the pickup review'
);
select ok(
  (select pickup_review_until between now() + interval '9 minutes' and now() + interval '11 minutes'
   from public.jobs where id = 'c1820000-0000-4000-8000-000000000011'),
  'the pickup review lasts 10 minutes'
);
reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
select is(
  (select body from public.notifications
   where job_id = 'c1820000-0000-4000-8000-000000000011' and kind = 'item_check'),
  'Your item is picked up. Something wrong? Tell us within 10 minutes.',
  'the customer is told about the 10-minute review'
);
select pg_temp.as_user('c1820000-0000-4000-8000-000000000002');
set local role authenticated;

select throws_ok(
  $$select public.advance_job('c1820000-0000-4000-8000-000000000011', 'delivered')$$,
  'that step is not available',
  'the driver cannot skip the pickup review'
);

reset role;
select pg_temp.as_user('c1820000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$select public.advance_job('c1820000-0000-4000-8000-000000000011', 'arrived')$$,
  'only the assigned driver can update this job',
  'another driver cannot move the job'
);

reset role;
select pg_temp.as_user('c1820000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.approve_pickup('c1820000-0000-4000-8000-000000000011')$$,
  'the customer accepts the pickup'
);
select is(
  (select status::text || '|' || pickup_review_result from public.jobs where id = 'c1820000-0000-4000-8000-000000000011'),
  'in_transit|accepted',
  'acceptance closes the review and lets the delivery continue'
);

reset role;
select pg_temp.as_user('c1820000-0000-4000-8000-000000000002');
set local role authenticated;
select lives_ok(
  $$select public.record_proof(
    'c1820000-0000-4000-8000-000000000011',
    'dropoff',
    'c1820000-0000-4000-8000-000000000011/dropoff/c1820000-0000-4000-8000-000000000022.jpg',
    '',
    'photo',
    false,
    null,
    null
  )$$,
  'the drop-off photo is stored'
);
select throws_ok(
  $$select public.advance_job('c1820000-0000-4000-8000-000000000011', 'delivered')$$,
  'that step is not available',
  'delivery waits until the driver arrives at the drop-off'
);
select lives_ok(
  $$select public.advance_job('c1820000-0000-4000-8000-000000000011', 'at_dropoff')$$,
  'the driver arrives at the drop-off'
);
select lives_ok(
  $$select public.advance_job('c1820000-0000-4000-8000-000000000011', 'at_dropoff')$$,
  'arriving twice does not add another event'
);
select is(
  (select count(*) from public.job_events
   where job_id = 'c1820000-0000-4000-8000-000000000011' and type = 'dropoff_arrived'),
  1::bigint,
  'one drop-off arrival is recorded'
);
select lives_ok(
  $$select public.advance_job('c1820000-0000-4000-8000-000000000011', 'delivered')$$,
  'delivered succeeds after the drop-off photo and arrival'
);
select is(
  (select status::text from public.jobs where id = 'c1820000-0000-4000-8000-000000000011'),
  'delivered',
  'the job is delivered once'
);

reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('pickuply.system_payment', 'yes', true);
insert into public.job_payments (job_id, payment_intent_id)
values ('c1820000-0000-4000-8000-000000000011', 'pi_testflow182');
select is(
  public.capture_context('c1820000-0000-4000-8000-000000000011') is null,
  true,
  'a new delivery is not captured before the customer confirms or 24 hours pass'
);
update public.jobs
set delivered_at = now() - interval '25 hours'
where id = 'c1820000-0000-4000-8000-000000000011';
select is(
  public.capture_context('c1820000-0000-4000-8000-000000000011')->>'kind',
  'full',
  'auto-completion uses the delivered time'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  offer_cents, assigned_driver_id, payment_status, pickup_review_until
) values (
  'c1820000-0000-4000-8000-000000000012', 'c1820000-0000-4000-8000-000000000001',
  'delivery', 'item_check', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'timeout', 1, 'medium', 0, 0, false, false, 'asap', 'fixed',
  5000, 'c1820000-0000-4000-8000-000000000002', 'authorized', now() - interval '1 minute'
);
select lives_ok(
  $$select public.close_pickup_review('c1820000-0000-4000-8000-000000000012')$$,
  'an expired review closes without a browser'
);
select is(
  (select status::text || '|' || pickup_review_result from public.jobs where id = 'c1820000-0000-4000-8000-000000000012'),
  'in_transit|timeout',
  'the timeout is recorded and the delivery can continue'
);
select lives_ok(
  $$select public.close_pickup_review('c1820000-0000-4000-8000-000000000012')$$,
  'closing the review again does nothing'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  offer_cents, assigned_driver_id, payment_status, dropoff_arrived_at
) values (
  'c1820000-0000-4000-8000-000000000013', 'c1820000-0000-4000-8000-000000000001',
  'delivery', 'in_transit', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'noshow', 1, 'medium', 0, 0, false, false, 'asap', 'fixed',
  5000, 'c1820000-0000-4000-8000-000000000002', 'authorized', now() - interval '16 minutes'
);
set local role authenticated;
select pg_temp.as_user('c1820000-0000-4000-8000-000000000002');
select throws_ok(
  $$select public.mark_customer_no_show('c1820000-0000-4000-8000-000000000013')$$,
  'add a photo of the wait',
  'a no-show still needs a photo'
);
select lives_ok(
  $$select public.record_proof(
    'c1820000-0000-4000-8000-000000000013',
    'no_show',
    'c1820000-0000-4000-8000-000000000013/no_show/c1820000-0000-4000-8000-000000000023.jpg',
    '',
    'photo',
    false,
    null,
    null
  )$$,
  'the wait photo is stored'
);
select lives_ok(
  $$select public.mark_customer_no_show('c1820000-0000-4000-8000-000000000013')$$,
  'the driver can report the no-show after 15 minutes'
);
select is(
  (select status::text || '|' || no_show_pending::text || '|' || payment_status::text
   from public.jobs where id = 'c1820000-0000-4000-8000-000000000013'),
  'in_transit|true|authorized',
  'the no-show timer does not cancel the job or capture payment'
);

select * from finish();
rollback;
