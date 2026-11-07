-- Local Supabase only. Do not run this against the hosted project.

begin;

select plan(12);

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
  set first_name = 'Test', last_name = 'Customer', full_name = 'Test Customer', phone = user_phone
  where id = uid;
end;
$$;

select pg_temp.make_user('c1290000-0000-4000-8000-000000000000', 'admin-129@pickuply.test', '+15555550190');
select pg_temp.make_user('c1290000-0000-4000-8000-000000000001', 'empty-129@pickuply.test', '+15555550191');
select pg_temp.make_user('c1290000-0000-4000-8000-000000000002', 'active-129@pickuply.test', '+15555550192');
select pg_temp.make_user('c1290000-0000-4000-8000-000000000003', 'done-129@pickuply.test', '+15555550193');
select pg_temp.make_user('c1290000-0000-4000-8000-000000000004', 'paid-129@pickuply.test', '+15555550194');
select pg_temp.make_user('c1290000-0000-4000-8000-000000000005', 'dispute-129@pickuply.test', '+15555550195');
select pg_temp.make_user('c1290000-0000-4000-8000-000000000006', 'plain-129@pickuply.test', '+15555550196');
update public.profiles set role = 'admin' where id = 'c1290000-0000-4000-8000-000000000000';

insert into public.jobs (
  id, customer_id, service, status, pickup_area, description, pieces, size, item_value_cents,
  stairs_pickup, elevator, help_loading, preferred_date, pricing_method
) values
  ('c1290000-0000-4000-8000-000000000102', 'c1290000-0000-4000-8000-000000000002', 'delivery', 'open', 'Austell', 'active dresser', 1, 'medium', 0, 0, false, false, 'asap', 'quote'),
  ('c1290000-0000-4000-8000-000000000103', 'c1290000-0000-4000-8000-000000000003', 'delivery', 'completed', 'Austell', 'finished dresser', 1, 'medium', 0, 0, false, false, 'asap', 'quote'),
  ('c1290000-0000-4000-8000-000000000104', 'c1290000-0000-4000-8000-000000000004', 'delivery', 'completed', 'Austell', 'paid dresser', 1, 'medium', 0, 0, false, false, 'asap', 'quote'),
  ('c1290000-0000-4000-8000-000000000105', 'c1290000-0000-4000-8000-000000000005', 'delivery', 'completed', 'Austell', 'disputed dresser', 1, 'medium', 0, 0, false, false, 'asap', 'quote');
update public.jobs
set payment_status = 'captured', captured_cents = 5000, stripe_payment_intent_id = 'pi_test129paid'
where id = 'c1290000-0000-4000-8000-000000000104';
insert into public.job_reports (id, job_id, reporter_id, category, description, outcome_wanted)
values ('c1290000-0000-4000-8000-000000000205', 'c1290000-0000-4000-8000-000000000105', 'c1290000-0000-4000-8000-000000000005', 'damaged', 'The dresser was scratched.', 'note');
insert into public.job_disputes (job_id, report_id)
values ('c1290000-0000-4000-8000-000000000105', 'c1290000-0000-4000-8000-000000000205');

set local role authenticated;
select pg_temp.as_user('c1290000-0000-4000-8000-000000000006');
select throws_ok(
  $$select public.admin_remove_customer('c1290000-0000-4000-8000-000000000001')$$,
  'P0001',
  'only an admin can remove a customer',
  'a customer cannot delete an account'
);

select pg_temp.as_user('c1290000-0000-4000-8000-000000000000');
select is(public.admin_remove_customer('c1290000-0000-4000-8000-000000000002'), 'has_active_job', 'an active request blocks deletion');
select is(public.admin_remove_customer('c1290000-0000-4000-8000-000000000003'), 'has_jobs', 'a completed request blocks deletion');
select is(public.admin_remove_customer('c1290000-0000-4000-8000-000000000004'), 'has_payment', 'payment history blocks deletion');
select is(public.admin_remove_customer('c1290000-0000-4000-8000-000000000005'), 'has_dispute', 'an open dispute blocks deletion');
select is(public.admin_remove_customer('c1290000-0000-4000-8000-000000000001'), 'removed', 'a customer with no requests can be deleted');
select is(public.admin_remove_customer('c1290000-0000-4000-8000-000000000001'), 'already_removed', 'deleting the same customer again does not change the account');

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);

select is(
  (select deleted_at is not null and phone is null and full_name = 'Deleted account' and first_name is null
   from public.profiles where id = 'c1290000-0000-4000-8000-000000000001'),
  true,
  'the empty customer profile is closed and the name and phone are cleared'
);
select is(
  (select phone is null and banned_until = 'infinity' from auth.users where id = 'c1290000-0000-4000-8000-000000000001'),
  true,
  'the old sign-in is disabled and the phone is released'
);
select lives_ok(
  $$insert into auth.users (
      instance_id, id, aud, role, email, phone, encrypted_password, email_confirmed_at, phone_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', 'c1290000-0000-4000-8000-000000000091', 'authenticated', 'authenticated',
      'again-129@pickuply.test', '+15555550191', 'test-hash', now(), now(), '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb, now(), now(), 'c1290000-0000-4000-8000-000000000091', '', 'c129-email', 'c129-recovery'
    )$$,
  'the same phone can register as a new account'
);
select is(
  (select count(*) from public.jobs where customer_id = 'c1290000-0000-4000-8000-000000000004'),
  1::bigint,
  'a blocked customer keeps the paid request'
);
select is(
  (select count(*) from public.audit_log where action = 'admin_remove_customer' and target_id = 'c1290000-0000-4000-8000-000000000001'),
  2::bigint,
  'the removal and the repeat are both audited'
);

select * from finish();
rollback;
