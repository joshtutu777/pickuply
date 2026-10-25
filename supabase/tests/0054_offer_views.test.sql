-- Offer counts are per job. A view is recorded only by mark_offers_viewed.

begin;

set local search_path to public, extensions;

select plan(31);

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

create or replace function pg_temp.as_db()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

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

update public.platform_settings set waves_enabled = false;

select pg_temp.make_user('e5400000-0000-4000-8000-000000000001', 'view-d1@pickuply.test');
select pg_temp.make_user('e5400000-0000-4000-8000-000000000002', 'view-d2@pickuply.test');
select pg_temp.make_user('e5400000-0000-4000-8000-000000000003', 'view-d3@pickuply.test');
select pg_temp.make_user('e5400000-0000-4000-8000-000000000004', 'view-customer@pickuply.test');
select pg_temp.make_user('e5400000-0000-4000-8000-000000000005', 'view-other@pickuply.test');

update public.profiles set role = 'driver' where id in (
  'e5400000-0000-4000-8000-000000000001',
  'e5400000-0000-4000-8000-000000000002',
  'e5400000-0000-4000-8000-000000000003'
);

insert into public.drivers (
  profile_id, status, zone_id, service_level, services, is_online
)
select id, 'active', (select id from public.zones where slug = 'west_metro'), 'full',
  array['delivery', 'junk', 'free_item', 'construction']::public.job_service[], true
from public.profiles
where id in (
  'e5400000-0000-4000-8000-000000000001',
  'e5400000-0000-4000-8000-000000000002',
  'e5400000-0000-4000-8000-000000000003'
);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
  item_value_cents, stairs_pickup, stairs_dropoff, elevator, help_loading, preferred_date,
  pricing_method, service_level, required_vehicle
) values (
  'e5400000-0000-4000-8000-000000000010',
  'e5400000-0000-4000-8000-000000000004',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Albany, 31721', 'Albany, 31721', 'View desk', 1, 'medium',
  0, 0, 0, false, false, 'asap', 'quote', 'light', null
);

select pg_temp.as_user('e5400000-0000-4000-8000-000000000001');
select lives_ok(
  $$select public.submit_offer('e5400000-0000-4000-8000-000000000010', 'offer', 3500, '')$$,
  'the first driver offers'
);
select pg_temp.as_user('e5400000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.submit_offer('e5400000-0000-4000-8000-000000000010', 'offer', 3600, '')$$,
  'the second driver offers'
);

select pg_temp.as_db();
do $$
begin
  perform set_config(
    'pickuply.sample_offer',
    (select id::text from public.job_offers where driver_id = 'e5400000-0000-4000-8000-000000000001'),
    false
  );
end $$;

select pg_temp.as_user('e5400000-0000-4000-8000-000000000004');
select is(
  (select active_offers from public.customer_offer_counts() where job_id = 'e5400000-0000-4000-8000-000000000010'),
  2,
  'both offers are active'
);
select is(
  (select new_offers from public.customer_offer_counts() where job_id = 'e5400000-0000-4000-8000-000000000010'),
  2,
  'both offers are new before they are displayed'
);
select is(
  (select count(*)::int from public.offer_views),
  0,
  'reading the counts does not mark an offer viewed'
);

select pg_temp.as_user('e5400000-0000-4000-8000-000000000005');
select is(
  (select count(*)::int from public.customer_offer_counts() where job_id = 'e5400000-0000-4000-8000-000000000010'),
  0,
  'another customer does not see these counts'
);
select is(
  public.mark_offers_viewed(array[current_setting('pickuply.sample_offer')::uuid]),
  0,
  'another customer cannot mark the offer viewed'
);

select pg_temp.as_user('e5400000-0000-4000-8000-000000000001');
select is(
  public.mark_offers_viewed(array[
    (select id from public.job_offers where driver_id = 'e5400000-0000-4000-8000-000000000001')
  ]),
  0,
  'a driver cannot mark an offer viewed'
);

select pg_temp.as_user('e5400000-0000-4000-8000-000000000004');
select throws_ok(
  $$insert into public.offer_views (offer_id, customer_id)
    values ('e5400000-0000-4000-8000-000000000010', 'e5400000-0000-4000-8000-000000000004')$$,
  'permission denied for table offer_views',
  'a customer cannot insert a view row directly'
);
select is(
  public.mark_offers_viewed(array[
    (select id from public.job_offers where driver_id = 'e5400000-0000-4000-8000-000000000001')
  ]),
  1,
  'the customer marks the displayed offer'
);
select is(
  public.mark_offers_viewed(array[
    (select id from public.job_offers where driver_id = 'e5400000-0000-4000-8000-000000000001')
  ]),
  0,
  'showing the same offer again does not add a second view'
);
select is(
  (select active_offers from public.customer_offer_counts() where job_id = 'e5400000-0000-4000-8000-000000000010'),
  2,
  'a viewed offer still counts as received'
);
select is(
  (select new_offers from public.customer_offer_counts() where job_id = 'e5400000-0000-4000-8000-000000000010'),
  1,
  'only the undisplayed offer stays new'
);
select is(
  (select viewed from public.offer_summaries('e5400000-0000-4000-8000-000000000010')
    where offer_id = (select id from public.job_offers where driver_id = 'e5400000-0000-4000-8000-000000000001')),
  true,
  'the displayed offer is viewed'
);
select is(
  (select viewed from public.offer_summaries('e5400000-0000-4000-8000-000000000010')
    where offer_id = (select id from public.job_offers where driver_id = 'e5400000-0000-4000-8000-000000000002')),
  false,
  'the other offer is still new'
);

select pg_temp.as_user('e5400000-0000-4000-8000-000000000002');
select lives_ok(
  'select public.withdraw_offer(''' || (select id::text from public.job_offers where driver_id = 'e5400000-0000-4000-8000-000000000002' and status = 'active') || ''')',
  'the second driver withdraws'
);
select pg_temp.as_user('e5400000-0000-4000-8000-000000000004');
select is(
  (select active_offers from public.customer_offer_counts() where job_id = 'e5400000-0000-4000-8000-000000000010'),
  1,
  'a withdrawn offer is not active'
);
select is(
  (select new_offers from public.customer_offer_counts() where job_id = 'e5400000-0000-4000-8000-000000000010'),
  0,
  'a withdrawn offer is not new'
);

select pg_temp.as_user('e5400000-0000-4000-8000-000000000003');
select lives_ok(
  $$select public.submit_offer('e5400000-0000-4000-8000-000000000010', 'offer', 3700, '')$$,
  'a third driver offers after the customer looked'
);
select pg_temp.as_user('e5400000-0000-4000-8000-000000000004');
select is(
  (select active_offers from public.customer_offer_counts() where job_id = 'e5400000-0000-4000-8000-000000000010'),
  2,
  'the new offer is received'
);
select is(
  (select new_offers from public.customer_offer_counts() where job_id = 'e5400000-0000-4000-8000-000000000010'),
  1,
  'the offer that arrived after viewing is new'
);

select pg_temp.as_db();
update public.job_offers
set expires_at = now() - interval '1 minute'
where driver_id = 'e5400000-0000-4000-8000-000000000003' and status = 'active';
select pg_temp.as_user('e5400000-0000-4000-8000-000000000004');
select is(
  (select active_offers from public.customer_offer_counts() where job_id = 'e5400000-0000-4000-8000-000000000010'),
  1,
  'an expired offer is not active'
);

select pg_temp.as_user('e5400000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.submit_offer('e5400000-0000-4000-8000-000000000010', 'offer', 3800, '')$$,
  'the second driver can offer again after withdrawing'
);
select pg_temp.as_db();
update public.job_offers
set status = 'declined'
where driver_id = 'e5400000-0000-4000-8000-000000000002' and status = 'active';
update public.job_offers
set status = 'expired'
where driver_id = 'e5400000-0000-4000-8000-000000000001' and status = 'active';
select pg_temp.as_user('e5400000-0000-4000-8000-000000000004');
select is(
  (select active_offers from public.customer_offer_counts() where job_id = 'e5400000-0000-4000-8000-000000000010'),
  0,
  'declined and expired offers are not active'
);
select is(
  public.mark_offers_viewed(array[
    (select id from public.job_offers where driver_id = 'e5400000-0000-4000-8000-000000000003')
  ]),
  1,
  'an old offer can still be recorded as viewed'
);
select is(
  (select count(*)::int from public.offer_views),
  2,
  'view history stays after the offer is no longer active'
);
select is(
  (select count(*)::int from public.offer_summaries('e5400000-0000-4000-8000-000000000010')),
  0,
  'the offer list hides inactive offers'
);
select is(public.mark_offers_viewed('{}'::uuid[]), 0, 'an empty list marks nothing');

select pg_temp.as_user('e5400000-0000-4000-8000-000000000005');
select is(
  (select count(*)::int from public.offer_views),
  0,
  'another customer cannot read the view history'
);

select pg_temp.as_db();
select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_offers'
  ),
  'offer changes can wake the customer list'
);
select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'offer_views'
  ),
  'a view on one device can wake the others'
);

select * from finish();
rollback;
