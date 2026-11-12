-- Local only. Not applied to the hosted database.
-- Requires migration 0132 and the pgTAP helpers used by the other SQL tests.

begin;

select plan(8);

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

select set_config('pickuply.phone_hmac_secret', 'local-test-secret', true);
select pg_temp.make_user('c1320000-0000-4000-8000-000000000001', 'mode-customer@pickuply.test');
update public.profiles set full_name = 'Mode Customer' where id = 'c1320000-0000-4000-8000-000000000001';

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values (
  'c1320000-0000-4000-8000-000000000011',
  'c1320000-0000-4000-8000-000000000001',
  'delivery', 'assigned',
  (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'mode guard', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000
);

insert into public.job_payments (job_id, payment_intent_id)
values ('c1320000-0000-4000-8000-000000000011', 'pi_modeguard0132');

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select public.note_stripe_livemode('c1320000-0000-4000-8000-000000000011', false);
select is(
  (select stripe_livemode from public.job_payments where job_id = 'c1320000-0000-4000-8000-000000000011'),
  false,
  'a blank mode can be recorded once'
);

select lives_ok(
  $$select public.note_stripe_livemode('c1320000-0000-4000-8000-000000000011', false)$$,
  'writing the same mode again is accepted'
);
select is(
  (select stripe_livemode from public.job_payments where job_id = 'c1320000-0000-4000-8000-000000000011'),
  false,
  'the same mode is still false'
);

select throws_ok(
  $$select public.note_stripe_livemode('c1320000-0000-4000-8000-000000000011', true)$$,
  'payment mode is already recorded',
  'a test payment cannot be changed to live'
);
select is(
  (select stripe_livemode from public.job_payments where job_id = 'c1320000-0000-4000-8000-000000000011'),
  false,
  'the saved mode stays false after a rejected live write'
);

select throws_ok(
  $$update public.job_payments set stripe_livemode = true where job_id = 'c1320000-0000-4000-8000-000000000011'$$,
  'payment mode is already recorded',
  'a direct service-role update cannot flip the mode'
);

reset role;
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method, offer_cents
) values (
  'c1320000-0000-4000-8000-000000000012',
  'c1320000-0000-4000-8000-000000000001',
  'delivery', 'assigned',
  (select id from public.zones where slug = 'west_metro'),
  'Austell 30168', 'live mode', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 5000
);
insert into public.job_payments (job_id, payment_intent_id, stripe_livemode)
values ('c1320000-0000-4000-8000-000000000012', 'pi_modeguard0132b', true);

select throws_ok(
  $$update public.job_payments set stripe_livemode = false where job_id = 'c1320000-0000-4000-8000-000000000012'$$,
  'payment mode is already recorded',
  'a live payment cannot be changed to test'
);
select is(
  (select count(*)::integer from public.job_payments where job_id in (
    'c1320000-0000-4000-8000-000000000011',
    'c1320000-0000-4000-8000-000000000012'
  )),
  2,
  'existing payment rows are kept'
);

select * from finish();
rollback;
