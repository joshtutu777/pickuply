-- Local only. Payment, ledger, refund, and dispute rules.

begin;

select plan(15);

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

select pg_temp.make_user('d2525252-2525-4252-8252-252525252521', 'pay-customer@pickuply.test');
select pg_temp.make_user('d2525252-2525-4252-8252-252525252522', 'pay-driver@pickuply.test');
select pg_temp.make_user('d2525252-2525-4252-8252-252525252523', 'pay-admin@pickuply.test');
select pg_temp.make_user('d2525252-2525-4252-8252-252525252524', 'pay-other@pickuply.test');

update public.profiles set role = 'driver', full_name = 'Pay Driver' where id = 'd2525252-2525-4252-8252-252525252522';
update public.profiles set role = 'admin', full_name = 'Pay Admin' where id = 'd2525252-2525-4252-8252-252525252523';
update public.profiles set full_name = 'Pay Customer' where id = 'd2525252-2525-4252-8252-252525252521';

insert into public.drivers (
  profile_id, status, zone_id, service_level, services, max_distance_miles, is_online,
  license_url, license_expires, insurance_expires, insurance_url
) values (
  'd2525252-2525-4252-8252-252525252522', 'active',
  (select id from public.zones where slug = 'west_metro'),
  'full', array['delivery', 'junk']::public.job_service[], 25, true,
  'd2525252-2525-4252-8252-252525252522/license.jpg', current_date + 30,
  current_date + 30, 'd2525252-2525-4252-8252-252525252522/insurance.jpg'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date,
  pricing_method, service_level, required_vehicle
) values
  (
    'd2525252-2525-4252-8252-252525252531', 'd2525252-2525-4252-8252-252525252521',
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell 30168', 'pay job', 1, 'medium', 0, 0, false, false, 'asap',
    'fixed', 'full', 'pickup'
  ),
  (
    'd2525252-2525-4252-8252-252525252532', 'd2525252-2525-4252-8252-252525252521',
    'junk', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell 30168', 'junk job', 1, 'medium', 0, 0, false, false, 'asap',
    'fixed', 'full', 'pickup'
  ),
  (
    'd2525252-2525-4252-8252-252525252533', 'd2525252-2525-4252-8252-252525252521',
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell 30168', 'hold job', 1, 'medium', 0, 0, false, false, 'asap',
    'fixed', 'full', 'pickup'
  );

select pg_temp.clear_auth();

update public.jobs
set status = 'assigned',
    assigned_driver_id = 'd2525252-2525-4252-8252-252525252522',
    payment_status = 'awaiting_payment',
    payment_due_at = now() + interval '30 minutes',
    price_cents = 9175,
    driver_pay_cents = 8000,
    platform_fee_cents = 1000,
    service_fee_cents = 175,
    dump_fee_cents = 4500
where id = 'd2525252-2525-4252-8252-252525252531';

update public.jobs
set status = 'assigned',
    assigned_driver_id = 'd2525252-2525-4252-8252-252525252522',
    payment_status = 'authorized',
    price_cents = 9175,
    driver_pay_cents = 8000,
    platform_fee_cents = 1000,
    service_fee_cents = 175,
    dump_fee_cents = 4500,
    captured_cents = null
where id = 'd2525252-2525-4252-8252-252525252532';

update public.jobs
set status = 'delivered',
    assigned_driver_id = 'd2525252-2525-4252-8252-252525252522',
    payment_status = 'authorized',
    price_cents = 9175,
    driver_pay_cents = 8000,
    platform_fee_cents = 1000,
    service_fee_cents = 175,
    customer_confirmed_at = now()
where id = 'd2525252-2525-4252-8252-252525252533';

insert into public.job_payments (job_id, payment_intent_id, charge_id, checkout_attempt)
values
  ('d2525252-2525-4252-8252-252525252532', 'pi_test252532', 'ch_test252532', 1),
  ('d2525252-2525-4252-8252-252525252533', 'pi_test252533', 'ch_test252533', 1);

select pg_temp.as_user('d2525252-2525-4252-8252-252525252522');
select throws_ok(
  $$select public.advance_job('d2525252-2525-4252-8252-252525252531', 'en_route')$$,
  'P0001',
  'payment must be authorized before work starts',
  'work cannot start before the card is authorized'
);

select pg_temp.as_user('d2525252-2525-4252-8252-252525252524');
select throws_ok(
  $$select public.approve_pickup('d2525252-2525-4252-8252-252525252531')$$,
  'P0001',
  'only the customer can approve the item',
  'a customer cannot approve someone else''s item'
);

select throws_ok(
  $$select public.begin_refund('d2525252-2525-4252-8252-252525252532', 1000, 'not allowed')$$,
  'P0001',
  'only an admin can refund',
  'only an admin can refund'
);

select throws_ok(
  $$select public.record_external_payment(
    'd2525252-2525-4252-8252-252525252531', 'cash', 'ref', 'because'
  )$$,
  'P0001',
  'only an admin can record an external payment',
  'only an admin can record an outside payment'
);

select throws_ok(
  $$select public.admin_override_status('d2525252-2525-4252-8252-252525252531', 'cancelled', 'nope')$$,
  'P0001',
  'only an admin can override a job',
  'only an admin can override status'
);

select pg_temp.clear_auth();
set local role service_role;
select public.post_driver_earnings('d2525252-2525-4252-8252-252525252531', now());
reset role;

select is(
  (select count(*) from public.ledger_entries where job_id = 'd2525252-2525-4252-8252-252525252531')::integer,
  0,
  'a ledger line is not created before capture'
);

select pg_temp.clear_auth();
update public.jobs
set status = 'completed', payment_status = 'captured', captured_cents = 9175
where id = 'd2525252-2525-4252-8252-252525252532';

set local role service_role;
select public.post_driver_earnings('d2525252-2525-4252-8252-252525252532', now());
reset role;

select is(
  (select amount_cents from public.ledger_entries where job_id = 'd2525252-2525-4252-8252-252525252532'),
  8000,
  'driver earnings do not include the disposal estimate'
);

insert into public.job_reports (job_id, reporter_id, category, description, outcome_wanted)
values (
  'd2525252-2525-4252-8252-252525252533',
  'd2525252-2525-4252-8252-252525252521',
  'damaged',
  'The item was damaged',
  'refund'
);
insert into public.job_disputes (job_id, report_id, capture_hold, payout_hold)
select 'd2525252-2525-4252-8252-252525252533', id, true, true
from public.job_reports
where job_id = 'd2525252-2525-4252-8252-252525252533';

select throws_ok(
  $$select public.record_capture('d2525252-2525-4252-8252-252525252533', 9175, 'full', 175)$$,
  'P0001',
  'capture is on hold while this job is disputed',
  'a disputed job cannot be captured'
);

select pg_temp.clear_auth();
select is(
  public.claim_stripe_event('evt_pay_0025', 'checkout.session.completed', null),
  true,
  'the first Stripe event is stored'
);
select is(
  public.claim_stripe_event('evt_pay_0025', 'checkout.session.completed', null),
  false,
  'a Stripe event id is stored once'
);

select pg_temp.as_user('d2525252-2525-4252-8252-252525252523');
select public.begin_refund('d2525252-2525-4252-8252-252525252532', 2000, 'partial before transfer');

select pg_temp.clear_auth();
set local role service_role;
select public.apply_refund(
  (select id from public.refund_requests where job_id = 'd2525252-2525-4252-8252-252525252532' and amount_cents = 2000),
  're_test252532',
  true
);
reset role;

select is(
  (select amount_cents from public.ledger_entries where job_id = 'd2525252-2525-4252-8252-252525252532'),
  6000,
  'a refund before transfer reduces the ledger'
);

select pg_temp.clear_auth();
update public.ledger_entries
set status = 'transferred', stripe_transfer_id = 'tr_test252532', transfer_status = 'created', amount_cents = 6000
where job_id = 'd2525252-2525-4252-8252-252525252532';

select pg_temp.as_user('d2525252-2525-4252-8252-252525252523');
select public.begin_refund('d2525252-2525-4252-8252-252525252532', 1000, 'refund after transfer');

select pg_temp.clear_auth();
set local role service_role;
select public.apply_refund(
  (select id from public.refund_requests where job_id = 'd2525252-2525-4252-8252-252525252532' and amount_cents = 1000),
  're_test252532b',
  true
);
reset role;

select is(
  (select amount_cents from public.ledger_entries where job_id = 'd2525252-2525-4252-8252-252525252532'),
  6000,
  'a refund after transfer does not reduce the ledger'
);
select is(
  (select count(*) from public.recovery_obligations where job_id = 'd2525252-2525-4252-8252-252525252532' and status = 'recovery_due')::integer,
  1,
  'a refund after transfer records a recovery and does not deduct it'
);

select pg_temp.clear_auth();
insert into public.job_payments (job_id, checkout_attempt, checkout_driver_id)
values (
  'd2525252-2525-4252-8252-252525252531',
  1,
  'd2525252-2525-4252-8252-252525252522'
);
set local role service_role;
select public.apply_authorization(
  'd2525252-2525-4252-8252-252525252531',
  'pi_test252531auth',
  'ch_test252531auth',
  now() + interval '7 days',
  'd2525252-2525-4252-8252-252525252522'
);
reset role;
select is(
  (select payment_status || '|' || charge_id
   from public.jobs
   join public.job_payments on job_payments.job_id = jobs.id
   where jobs.id = 'd2525252-2525-4252-8252-252525252531'),
  'authorized|ch_test252531auth',
  'recording an authorization stores the charge id'
);

select pg_temp.clear_auth();
insert into public.ledger_entries (job_id, driver_id, amount_cents, status)
values (
  'd2525252-2525-4252-8252-252525252531',
  'd2525252-2525-4252-8252-252525252522',
  8000,
  'pending'
);

select pg_temp.as_user('d2525252-2525-4252-8252-252525252523');
select public.record_external_payment(
  (select id from public.ledger_entries where job_id = 'd2525252-2525-4252-8252-252525252531'),
  'cash',
  'outside-1',
  'paid by hand'
);

select is(
  (select status from public.ledger_entries where job_id = 'd2525252-2525-4252-8252-252525252531'),
  'externally_paid',
  'an outside payment is recorded as externally paid'
);

select * from finish();
rollback;
