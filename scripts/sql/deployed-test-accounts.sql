-- Local synthetic roster for the deployed-test account plan.
-- No Stripe ids, no transfers, and no outbound notification rows are left behind.
-- Run only through scripts/provision-deployed-test-accounts.mjs against local Supabase.

begin;

create temporary table seed_people (
  phone text primary key,
  full_name text not null,
  role public.profile_role not null,
  driver_status public.driver_status,
  is_online boolean not null default false,
  insurance boolean not null default false,
  payout_started boolean not null default false
) on commit drop;

insert into seed_people (phone, full_name, role, driver_status, is_online, insurance, payout_started) values
  ('5555550301', 'Casey Customer', 'customer', null, false, false, false),
  ('5555550302', 'Quinn Customer', 'customer', null, false, false, false),
  ('5555550303', 'Riley Customer', 'customer', null, false, false, false),
  ('5555550304', 'Avery Customer', 'customer', null, false, false, false),
  ('5555550305', 'Jordan Customer', 'customer', null, false, false, false),
  ('5555550306', 'Pat Driver', 'driver', 'applied', false, false, false),
  ('5555550307', 'Sam Driver', 'driver', 'pending_review', false, false, false),
  ('5555550308', 'Taylor Driver', 'driver', 'active', true, true, false),
  ('5555550309', 'Morgan Driver', 'driver', 'active', true, true, true),
  ('5555550310', 'Reese Driver', 'driver', 'paused', false, true, false),
  ('5555550311', 'Sky Admin', 'admin', null, false, false, false),
  ('5555550312', 'Rowan Admin', 'admin', null, false, false, false),
  ('5555550313', 'Jamie Both', 'driver', 'active', false, true, false);

create temporary table seed_ids on commit drop as
select seed_people.phone, profiles.id
from seed_people
join public.profiles on right(regexp_replace(profiles.phone, '\D', '', 'g'), 10) = seed_people.phone;

do $$
begin
  if (select count(*) from seed_ids) <> 13 then
    raise exception 'expected 13 local profiles for the synthetic roster';
  end if;
end $$;

update public.profiles
set role = seed_people.role,
    full_name = seed_people.full_name,
    is_test = true
from seed_people
join seed_ids on seed_ids.phone = seed_people.phone
where profiles.id = seed_ids.id;

insert into public.notification_preferences (profile_id, push_enabled, email_enabled, sms_enabled, promotional_sms)
select id, false, false, false, false from seed_ids
on conflict (profile_id) do update
set push_enabled = false,
    email_enabled = false,
    sms_enabled = false,
    promotional_sms = false;

insert into public.drivers (
  profile_id, status, zone_id, service_level, services, max_distance_miles, is_online,
  license_url, license_expires, insurance_url, insurance_expires, terms_version, terms_accepted_at,
  training_completed_at, checklist_required
)
select
  seed_ids.id,
  seed_people.driver_status,
  (select id from public.zones where slug = 'west_metro'),
  'full',
  array['delivery', 'junk']::public.job_service[],
  25,
  seed_people.is_online,
  seed_ids.id::text || '/license.jpg',
  current_date + 30,
  case when seed_people.insurance then seed_ids.id::text || '/insurance.jpg' else null end,
  case when seed_people.insurance then current_date + 30 else null end,
  'driver-terms-v2',
  now(),
  case when seed_people.driver_status in ('active', 'paused') then now() else null end,
  true
from seed_people
join seed_ids on seed_ids.phone = seed_people.phone
where seed_people.driver_status is not null
on conflict (profile_id) do update
set status = excluded.status,
    is_online = excluded.is_online,
    insurance_url = excluded.insurance_url,
    insurance_expires = excluded.insurance_expires,
    terms_version = excluded.terms_version,
    terms_accepted_at = excluded.terms_accepted_at,
    training_completed_at = excluded.training_completed_at;

delete from public.driver_connect_accounts
where driver_id in (select id from seed_ids);

insert into public.driver_connect_accounts (
  driver_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted, requirements_due
)
select seed_ids.id, 'acct_testpickuply0309', false, false, false, array['external_account']
from seed_ids
where phone = '5555550309';

-- Replace only this roster's fixture jobs.
create temporary table fixture_jobs (id uuid primary key) on commit drop;
insert into fixture_jobs values
  ('c1300000-0000-4000-8000-000000000302'),
  ('c1300000-0000-4000-8000-000000000303'),
  ('c1300000-0000-4000-8000-000000000304'),
  ('c1300000-0000-4000-8000-000000000305'),
  ('c1300000-0000-4000-8000-000000000313');

delete from public.ledger_entries where job_id in (select id from fixture_jobs);
delete from public.job_disputes where job_id in (select id from fixture_jobs);
delete from public.job_reports where job_id in (select id from fixture_jobs);
delete from public.job_reviews where job_id in (select id from fixture_jobs);
delete from public.notifications where job_id in (select id from fixture_jobs);
delete from public.jobs where id in (select id from fixture_jobs);

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method,
  offer_cents, budget_min_cents, budget_max_cents, price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents,
  assigned_driver_id, payment_status, captured_cents
) values
  (
    'c1300000-0000-4000-8000-000000000302',
    (select id from seed_ids where phone = '5555550302'),
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell 30106', 'Hiram 30141', 'Synthetic open dresser request', 1, 'medium',
    0, 0, false, false, 'asap', 'fixed', 6000, null, null, null, null, null, null, null, null, null
  ),
  (
    'c1300000-0000-4000-8000-000000000303',
    (select id from seed_ids where phone = '5555550303'),
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Mableton 30126', 'Austell 30168', 'Synthetic booking waiting for a card', 1, 'medium',
    0, 0, false, false, 'asap', 'fixed', 6000, null, null, null, null, null, null, null, null, null
  ),
  (
    'c1300000-0000-4000-8000-000000000304',
    (select id from seed_ids where phone = '5555550304'),
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Douglasville 30134', 'Lithia Springs 30122', 'Synthetic completed bookshelf', 1, 'medium',
    0, 0, false, false, 'asap', 'fixed', 6000, null, null, null, null, null, null, null, null, null
  ),
  (
    'c1300000-0000-4000-8000-000000000305',
    (select id from seed_ids where phone = '5555550305'),
    'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
    'Powder Springs 30127', 'Hiram 30141', 'Synthetic disputed chair', 1, 'small',
    0, 0, false, false, 'asap', 'fixed', 6000, null, null, null, null, null, null, null, null, null
  ),
  (
    'c1300000-0000-4000-8000-000000000313',
    (select id from seed_ids where phone = '5555550313'),
    'junk', 'open', (select id from public.zones where slug = 'west_metro'),
    'Austell 30106', null, 'Synthetic junk request from the dual-role account', 1, 'medium',
    0, 0, false, false, 'asap', 'range', null, 5000, 8000, null, null, null, null,
    null, null, null
  );

update public.jobs
set status = 'assigned',
    assigned_driver_id = (select id from seed_ids where phone = '5555550308'),
    price_cents = 6354,
    driver_pay_cents = 5000,
    platform_fee_cents = 1000,
    service_fee_cents = 354,
    commission_bps = 1667,
    payment_status = 'awaiting_payment',
    payment_due_at = now() + interval '30 minutes'
where id = 'c1300000-0000-4000-8000-000000000303';

update public.jobs
set status = 'assigned',
    assigned_driver_id = (select id from seed_ids where phone = '5555550308'),
    price_cents = 6354,
    driver_pay_cents = 5000,
    platform_fee_cents = 1000,
    service_fee_cents = 354,
    commission_bps = 1667,
    payment_status = 'authorized'
where id = 'c1300000-0000-4000-8000-000000000304';

update public.jobs
set status = 'completed',
    payment_status = 'captured',
    captured_cents = 6354
where id = 'c1300000-0000-4000-8000-000000000304';

update public.jobs
set status = 'assigned',
    assigned_driver_id = (select id from seed_ids where phone = '5555550309'),
    price_cents = 6354,
    driver_pay_cents = 5000,
    platform_fee_cents = 1000,
    service_fee_cents = 354,
    commission_bps = 1667,
    payment_status = 'authorized'
where id = 'c1300000-0000-4000-8000-000000000305';

update public.jobs
set status = 'disputed'
where id = 'c1300000-0000-4000-8000-000000000305';

insert into public.job_private (
  job_id, pickup_address, dropoff_address, customer_name, customer_phone
)
select
  jobs.id,
  '1 Synthetic Lane',
  case when jobs.dropoff_area is null then null else '2 Synthetic Lane' end,
  profiles.full_name,
  profiles.phone
from public.jobs
join public.profiles on profiles.id = jobs.customer_id
where jobs.id in (select id from fixture_jobs);

insert into public.job_events (job_id, actor_id, type, data)
select id, customer_id, 'status', jsonb_build_object('to', status)
from public.jobs
where id in (select id from fixture_jobs);

insert into public.job_reviews (job_id, reviewer_id, reviewee_id, reviewer_role, stars, body)
values (
  'c1300000-0000-4000-8000-000000000304',
  (select id from seed_ids where phone = '5555550304'),
  (select id from seed_ids where phone = '5555550308'),
  'customer',
  5,
  'Synthetic review. Careful with the bookshelf.'
);

insert into public.job_reports (id, job_id, reporter_id, category, description, outcome_wanted)
values (
  'c1300000-0000-4000-8000-0000000003a5',
  'c1300000-0000-4000-8000-000000000305',
  (select id from seed_ids where phone = '5555550305'),
  'damaged',
  'Synthetic problem report. The chair leg was cracked after delivery.',
  'refund'
);

insert into public.job_disputes (job_id, report_id, capture_hold, payout_hold)
values (
  'c1300000-0000-4000-8000-000000000305',
  'c1300000-0000-4000-8000-0000000003a5',
  true,
  true
);

select public.post_driver_earnings(
  'c1300000-0000-4000-8000-000000000304',
  now() + interval '48 hours'
);

delete from public.notifications
where profile_id in (select id from seed_ids)
   or job_id in (select id from fixture_jobs);

commit;
