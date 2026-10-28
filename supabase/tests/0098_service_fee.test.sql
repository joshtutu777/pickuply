-- Service fee: 5 percent of the offer, snapshotted, and kept out of fee-only charges.

begin;

select plan(15);

create or replace function pg_temp.make_user(uid uuid, email text)
returns void language plpgsql as $$
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

create or replace function pg_temp.as_user(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.make_user('c1980000-0000-4000-8000-000000000010', 'service-fee-customer@pickuply.test');
select pg_temp.make_user('c1980000-0000-4000-8000-000000000011', 'service-fee-admin@pickuply.test');
update public.profiles set role = 'admin' where id = 'c1980000-0000-4000-8000-000000000011';

select is(
  (public.price_breakdown('forward', 10000)->>'service_fee_cents')::int,
  500,
  'a $100 offer has a $5 service fee'
);
select is(
  (public.price_breakdown('forward', 10000)->>'customer_total_cents')::int,
  10500,
  'a $100 offer totals $105'
);
select is(
  (public.price_breakdown('forward', 10000)->>'driver_earnings_cents')::int,
  8500,
  'the driver still receives 85 percent'
);
select is(
  public.round_half_up(10 * 500, 10000),
  1,
  'ten cents at 5 percent rounds half up to one cent'
);

do $$
declare
  cents integer;
  fee integer;
begin
  for cents in 3500..3999 loop
    fee := (public.price_breakdown('forward', cents)->>'service_fee_cents')::int;
    if fee is distinct from public.round_half_up(cents * 500, 10000) then
      raise exception 'service fee mismatch at %', cents;
    end if;
  end loop;
end $$;

select ok(true, '500 offer amounts match the database service fee');

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents, service_fee_bps
) values (
  'c1980000-0000-4000-8000-000000000001',
  'c1980000-0000-4000-8000-000000000010',
  'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'old booking', 1, 'medium', 0, 0, false, false, 'asap', 'quote',
  5180, 4250, 750, 180, null
);

update public.platform_settings set service_fee_bps = 700 where id = 1;
select is(
  (select price_cents from public.jobs where id = 'c1980000-0000-4000-8000-000000000001'),
  5180,
  'changing the rate does not rewrite an older booking'
);
update public.platform_settings set service_fee_bps = 500 where id = 1;

update public.jobs
set payment_status = 'captured', captured_cents = 10500, refunded_cents = 0, service_fee_cents = 500
where id = 'c1980000-0000-4000-8000-000000000001';
select is(public.refund_cap_cents('c1980000-0000-4000-8000-000000000001', false), 10000, 'a partial refund keeps the service fee');
select is(public.refund_cap_cents('c1980000-0000-4000-8000-000000000001', true), 10500, 'a full fault refund includes the service fee');

update public.jobs
set captured_cents = 1500, late_cancel_cents = 1500, service_fee_cents = 500
where id = 'c1980000-0000-4000-8000-000000000001';
select is(public.refund_cap_cents('c1980000-0000-4000-8000-000000000001', false), 1500, 'a late cancellation has no service fee to retain');

update public.jobs
set captured_cents = 2500, late_cancel_cents = null, trip_fee_cents = 2500
where id = 'c1980000-0000-4000-8000-000000000001';
select is(public.refund_cap_cents('c1980000-0000-4000-8000-000000000001', false), 2500, 'a trip fee has no service fee to retain');

select pg_temp.as_user('c1980000-0000-4000-8000-000000000011');
select throws_ok(
  $$select public.update_platform_settings(1500, 0, 10000, 0, 30)$$,
  'service fee rate is not valid',
  'an admin cannot save a service fee of 100 percent or more'
);
select lives_ok(
  $$select public.update_platform_settings(1500, 0, 400, 0, 30)$$,
  'an admin can save a 4 percent service fee'
);
select is(
  (select price_cents from public.jobs where id = 'c1980000-0000-4000-8000-000000000001'),
  5180,
  'the new rate does not rewrite the older booking'
);
select lives_ok(
  $$select public.update_platform_settings(1500, 0, 500, 0, 30)$$,
  'the test restores the 5 percent rate'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$select public.begin_refund('c1980000-0000-4000-8000-000000000001', 100, 'test', false)$$,
  'only an admin can refund',
  'a customer cannot refund'
);

select * from finish();
rollback;
