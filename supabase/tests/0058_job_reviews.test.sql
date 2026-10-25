-- Local only. Reviews stay hidden until both are in, or 14 days after completion.

begin;

select plan(9);

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
    execute format('grant execute on all functions in schema %I to anon, authenticated, service_role', sch);
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

select pg_temp.make_user('c1580000-0000-4000-8000-000000000001', 'review-customer@pickuply.test');
select pg_temp.make_user('c1580000-0000-4000-8000-000000000002', 'review-driver@pickuply.test');
select pg_temp.make_user('c1580000-0000-4000-8000-000000000003', 'review-admin@pickuply.test');
select pg_temp.make_user('c1580000-0000-4000-8000-000000000004', 'review-other@pickuply.test');

update public.profiles set role = 'driver', full_name = 'Review Driver' where id = 'c1580000-0000-4000-8000-000000000002';
update public.profiles set role = 'admin', full_name = 'Review Admin' where id = 'c1580000-0000-4000-8000-000000000003';
update public.profiles set full_name = 'Review Customer' where id = 'c1580000-0000-4000-8000-000000000001';

insert into public.drivers (profile_id, status, zone_id, service_level, services, is_online)
values (
  'c1580000-0000-4000-8000-000000000002', 'active',
  (select id from public.zones where slug = 'west_metro'),
  'full', array['delivery']::public.job_service[], true
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method
) values (
  'c1580000-0000-4000-8000-000000000011', 'c1580000-0000-4000-8000-000000000001',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'review job', 1, 'medium', 0, 0, false, false, 'asap', 'fixed'
);

update public.jobs
set status = 'completed',
    assigned_driver_id = 'c1580000-0000-4000-8000-000000000002',
    payment_status = 'captured',
    customer_confirmed_at = now()
where id = 'c1580000-0000-4000-8000-000000000011';

select pg_temp.as_user('c1580000-0000-4000-8000-000000000004');
set local role authenticated;

select throws_ok(
  $$select public.submit_job_review('c1580000-0000-4000-8000-000000000011', 5, 'not my job')$$,
  'only the customer and the assigned driver can review',
  'a stranger cannot review'
);

reset role;
select pg_temp.as_user('c1580000-0000-4000-8000-000000000001');
set local role authenticated;

select lives_ok(
  $$select public.submit_job_review('c1580000-0000-4000-8000-000000000011', 5, 'Careful with the sofa')$$,
  'the customer can review a completed job'
);

select throws_ok(
  $$select public.submit_job_review('c1580000-0000-4000-8000-000000000011', 4, 'again')$$,
  '23505',
  null,
  'the same person cannot review twice'
);

reset role;
select pg_temp.as_user('c1580000-0000-4000-8000-000000000002');
set local role authenticated;

select is_empty(
  $$select stars from public.job_reviews where reviewer_role = 'customer'$$,
  'the driver cannot read the customer review before both are in'
);

select lives_ok(
  $$select public.submit_job_review('c1580000-0000-4000-8000-000000000011', 4, 'Clear instructions')$$,
  'the driver can review the customer'
);

select results_eq(
  $$select stars from public.job_reviews where reviewer_role = 'customer'$$,
  $$values (5)$$,
  'both reviews make the customer review visible'
);

reset role;
select pg_temp.as_user('c1580000-0000-4000-8000-000000000001');
set local role authenticated;

select throws_ok(
  $$select public.hide_job_review((select id from public.job_reviews where reviewer_role = 'driver'))$$,
  'only an admin can hide a review',
  'a customer cannot hide a review'
);

reset role;
select pg_temp.as_user('c1580000-0000-4000-8000-000000000003');
set local role authenticated;

select lives_ok(
  $$select public.hide_job_review((select id from public.job_reviews where reviewer_role = 'driver'))$$,
  'an admin can hide a review'
);

select results_eq(
  $$select stars, body from public.job_reviews where reviewer_role = 'driver'$$,
  $$values (4, 'Clear instructions')$$,
  'hiding a review does not rewrite it'
);

select * from finish();
rollback;
