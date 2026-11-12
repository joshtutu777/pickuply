-- Local Supabase only. Do not run this against the hosted project.

begin;

select plan(17);

create or replace function pg_temp.as_user(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.make_user(uid uuid, email text, user_phone text)
returns void language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, phone, encrypted_password, email_confirmed_at, phone_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    email, user_phone, 'test-hash', now(), now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now(), uid::text, '', uid::text || '-email', uid::text || '-recovery'
  );
  update public.profiles
  set first_name = 'Test', last_name = 'Person', full_name = 'Test Person', phone = user_phone
  where id = uid;
end;
$$;

select pg_temp.make_user('c1300000-0000-4000-8000-000000000000', 'admin-130@pickuply.test', '+15555501300');
select pg_temp.make_user('c1300000-0000-4000-8000-000000000001', 'customer-130@pickuply.test', '+15555501301');
select pg_temp.make_user('c1300000-0000-4000-8000-000000000002', 'driver-130@pickuply.test', '+15555501302');
select pg_temp.make_user('c1300000-0000-4000-8000-000000000003', 'other-130@pickuply.test', '+15555501303');
update public.profiles set role = 'admin' where id = 'c1300000-0000-4000-8000-000000000000';
insert into public.drivers (profile_id, status, zone_id, is_online)
values (
  'c1300000-0000-4000-8000-000000000002',
  'active',
  (select id from public.zones limit 1),
  false
);

insert into public.jobs (
  id, customer_id, service, status, pickup_area, description, pieces, size, item_value_cents,
  stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values
  ('c1300000-0000-4000-8000-000000000101', 'c1300000-0000-4000-8000-000000000001', 'delivery', 'open', 'Austell', 'open dresser', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1300000-0000-4000-8000-000000000102', 'c1300000-0000-4000-8000-000000000001', 'delivery', 'open', 'Austell', 'offered dresser', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1300000-0000-4000-8000-000000000103', 'c1300000-0000-4000-8000-000000000001', 'delivery', 'open', 'Austell', 'assigned dresser', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1300000-0000-4000-8000-000000000104', 'c1300000-0000-4000-8000-000000000001', 'delivery', 'open', 'Austell', 'authorized dresser', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1300000-0000-4000-8000-000000000105', 'c1300000-0000-4000-8000-000000000001', 'delivery', 'open', 'Austell', 'charged dresser', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1300000-0000-4000-8000-000000000106', 'c1300000-0000-4000-8000-000000000001', 'delivery', 'open', 'Austell', 'disputed dresser', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000),
  ('c1300000-0000-4000-8000-000000000107', 'c1300000-0000-4000-8000-000000000001', 'delivery', 'open', 'Austell', 'refund dresser', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000);
insert into public.jobs (
  id, customer_id, service, status, pickup_area, description, pieces, size, item_value_cents,
  stairs_pickup, elevator, help_loading, preferred_date, pricing_method
) values (
  'c1300000-0000-4000-8000-000000000108', 'c1300000-0000-4000-8000-000000000001', 'delivery', 'quoted', 'Austell', 'quote dresser', 1, 'medium', 0, 0, false, false, 'asap', 'quote'
);

update public.jobs
set status = 'assigned', assigned_driver_id = 'c1300000-0000-4000-8000-000000000002'
where id = 'c1300000-0000-4000-8000-000000000103';
update public.jobs set payment_status = 'authorized' where id = 'c1300000-0000-4000-8000-000000000104';
update public.jobs
set payment_status = 'captured', captured_cents = 5000, stripe_payment_intent_id = 'pi_test130charge'
where id = 'c1300000-0000-4000-8000-000000000105';

insert into public.job_offers (
  job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents,
  customer_total_cents, status, expires_at
) values (
  'c1300000-0000-4000-8000-000000000102', 'c1300000-0000-4000-8000-000000000002',
  'accept', 5000, 0, 0, 5000, 'active', now() + interval '1 day'
);
insert into public.job_reports (id, job_id, reporter_id, category, description, outcome_wanted)
values (
  'c1300000-0000-4000-8000-000000000206',
  'c1300000-0000-4000-8000-000000000106',
  'c1300000-0000-4000-8000-000000000001',
  'other',
  'The request should stay open.',
  'note'
);
insert into public.job_disputes (job_id, report_id)
values ('c1300000-0000-4000-8000-000000000106', 'c1300000-0000-4000-8000-000000000206');
insert into public.refund_requests (job_id, amount_cents, reason, status, created_by)
values ('c1300000-0000-4000-8000-000000000107', 1000, 'customer refund', 'pending', 'c1300000-0000-4000-8000-000000000000');

set local role authenticated;
select pg_temp.as_user('c1300000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.admin_remove_from_marketplace('c1300000-0000-4000-8000-000000000101')$$,
  'P0001',
  'only an admin can remove a request from the marketplace',
  'a customer cannot remove a request'
);

select pg_temp.as_user('c1300000-0000-4000-8000-000000000000');
select is(public.admin_remove_from_marketplace('c1300000-0000-4000-8000-000000000103'), 'has_driver', 'an assigned driver blocks removal');
select is(public.admin_remove_from_marketplace('c1300000-0000-4000-8000-000000000104'), 'has_payment', 'a card authorization blocks removal');
select is(public.admin_remove_from_marketplace('c1300000-0000-4000-8000-000000000105'), 'has_payment', 'a charge blocks removal');
select is(public.admin_remove_from_marketplace('c1300000-0000-4000-8000-000000000106'), 'has_dispute', 'a dispute blocks removal');
select is(public.admin_remove_from_marketplace('c1300000-0000-4000-8000-000000000107'), 'has_payment', 'a refund blocks removal');
select is(public.admin_remove_from_marketplace('c1300000-0000-4000-8000-000000000108'), 'not_posted', 'a request that is not posted stays as it is');
select is(public.admin_remove_from_marketplace('c1300000-0000-4000-8000-000000000102'), 'removed', 'a posted request with an offer can be removed');
select is(public.admin_remove_from_marketplace('c1300000-0000-4000-8000-000000000102'), 'already_removed', 'removing the same request again does not change it');
select is(public.admin_remove_from_marketplace('c1300000-0000-4000-8000-000000000101'), 'removed', 'a posted request with no offers can be removed');

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);

select is(
  (select status from public.jobs where id = 'c1300000-0000-4000-8000-000000000101'),
  'cancelled',
  'the posted request is cancelled and still stored'
);
select is(
  (select status from public.job_offers where job_id = 'c1300000-0000-4000-8000-000000000102'),
  'declined',
  'the open offer is closed and the offer row stays'
);
select is(
  (select status from public.jobs where id = 'c1300000-0000-4000-8000-000000000103'),
  'assigned',
  'an assigned request is unchanged'
);
select is(
  (select count(*)::integer from public.job_events where job_id = 'c1300000-0000-4000-8000-000000000102' and type = 'removed_from_marketplace'),
  1,
  'a repeated removal does not write a second history row'
);
select is(
  (select count(*)::integer from public.audit_log where target_id = 'c1300000-0000-4000-8000-000000000102' and action = 'admin_remove_from_marketplace'),
  2,
  'the removal and the repeat are both audited'
);
select is(
  (select count(*)::integer from public.audit_log
    where target_id = 'c1300000-0000-4000-8000-000000000102'
      and action = 'admin_remove_from_marketplace'
      and data->>'outcome' = 'removed'),
  1,
  'a repeated removal does not record a second success'
);
select is(
  (select public.driver_is_eligible_for_job('c1300000-0000-4000-8000-000000000101')),
  false,
  'the removed request is off the driver feed'
);

select * from finish();
rollback;
