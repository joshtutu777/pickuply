-- A driver can keep a test Connect account and a separate live one.
-- A test account id is never reused as a live account.
-- Live tips are recorded only while platform_settings.payments_mode is live.
-- The 8-argument upsert stays so the currently deployed app can still save a test payout account.
-- Do not apply this file until the owner approves it.

alter table public.driver_connect_accounts
  add column if not exists livemode boolean not null default false;

alter table public.driver_connect_accounts drop constraint driver_connect_accounts_pkey;
alter table public.driver_connect_accounts add primary key (driver_id, livemode);

create or replace function public.upsert_connect_account(
  target_driver uuid,
  account_id text,
  charges_enabled boolean,
  payouts_enabled boolean,
  details_submitted boolean,
  requirements_due text[],
  disabled_reason text,
  transfers_active boolean,
  account_livemode boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_driver is null or account_id is null or account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception 'a Stripe account id is required';
  end if;
  if not exists (select 1 from public.drivers where profile_id = target_driver) then
    raise exception 'that person is not a driver';
  end if;

  insert into public.driver_connect_accounts (
    driver_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted,
    requirements_due, disabled_reason, transfers_active, livemode, synced_at
  ) values (
    target_driver, account_id, coalesce(charges_enabled, false), coalesce(payouts_enabled, false),
    coalesce(details_submitted, false), coalesce(requirements_due, '{}'), nullif(disabled_reason, ''),
    coalesce(transfers_active, false), coalesce(account_livemode, false), now()
  )
  on conflict (driver_id, livemode) do update
  set charges_enabled = excluded.charges_enabled,
      payouts_enabled = excluded.payouts_enabled,
      details_submitted = excluded.details_submitted,
      requirements_due = excluded.requirements_due,
      disabled_reason = excluded.disabled_reason,
      transfers_active = excluded.transfers_active,
      synced_at = now()
  where public.driver_connect_accounts.stripe_account_id = excluded.stripe_account_id;

  if not exists (
    select 1 from public.driver_connect_accounts
    where driver_id = target_driver
      and stripe_account_id = account_id
      and livemode = coalesce(account_livemode, false)
  ) then
    raise exception 'this driver already has a different payout account';
  end if;
end;
$$;

revoke all on function public.upsert_connect_account(uuid, text, boolean, boolean, boolean, text[], text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.upsert_connect_account(uuid, text, boolean, boolean, boolean, text[], text, boolean, boolean)
  to service_role;

-- The deployed app calls this 8-argument form. It stores a test account and does not replace a live one.
create or replace function public.upsert_connect_account(
  target_driver uuid,
  account_id text,
  charges_enabled boolean,
  payouts_enabled boolean,
  details_submitted boolean,
  requirements_due text[],
  disabled_reason text,
  transfers_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.upsert_connect_account(
    target_driver,
    account_id,
    charges_enabled,
    payouts_enabled,
    details_submitted,
    requirements_due,
    disabled_reason,
    transfers_active,
    false
  );
end;
$$;

revoke all on function public.upsert_connect_account(uuid, text, boolean, boolean, boolean, text[], text, boolean)
  from public, anon, authenticated;
grant execute on function public.upsert_connect_account(uuid, text, boolean, boolean, boolean, text[], text, boolean)
  to service_role;

create or replace function public.assert_driver_can_take_job(target_job uuid, action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  driver_row public.drivers%rowtype;
  job_row public.jobs%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if public.account_is_suspended(uid) then
    raise exception 'Your Pickuply driver account is restricted. You cannot submit offers or accept new jobs while this restriction is active.';
  end if;
  if exists (select 1 from public.drivers where profile_id = uid and driving_stopped_at is not null) then
    raise exception 'You stopped driving. You cannot submit offers or accept new jobs.';
  end if;
  if public.phone_is_restricted((select phone from public.profiles where id = uid)) then
    raise exception 'This phone number cannot be used for Pickuply right now. Contact support if you think this is a mistake.';
  end if;
  select * into driver_row from public.drivers where profile_id = uid;
  if not found or driver_row.status not in ('active', 'approved_new') then
    raise exception 'Finish setup to accept jobs.';
  end if;
  if exists (
    select 1 from public.platform_settings
    where id = 1 and payments_mode = 'live'
  ) and not coalesce((select is_test from public.profiles where id = uid), false) then
    if not exists (
      select 1 from public.driver_connect_accounts
      where driver_id = uid
        and payouts_enabled
        and transfers_active
        and livemode
    ) then
      raise exception 'Finish payout setup before accepting jobs.';
    end if;
  end if;
  if not driver_row.is_online then
    if action = 'offer' then
      raise exception 'go online before sending an offer';
    end if;
    raise exception 'go online before claiming a job';
  end if;
  select * into job_row from public.jobs where id = target_job;
  if found and (public.account_is_suspended(job_row.customer_id) or job_row.suspension_hold) then
    raise exception 'This request is no longer available.';
  end if;
  if found and job_row.required_vehicle is not null and not exists (
    select 1 from public.vehicles
    where driver_id = uid and type = job_row.required_vehicle
  ) then
    raise exception 'This job needs a different vehicle.';
  end if;
  if not public.driver_is_eligible_for_job(target_job) then
    if action = 'offer' then
      raise exception 'this driver cannot offer on this job';
    end if;
    raise exception 'this driver cannot claim this job';
  end if;
end;
$$;

create or replace function public.ready_transfers(target_livemode boolean default false)
returns table (
  entry_id uuid,
  amount_cents integer,
  driver_id uuid,
  stripe_account_id text,
  charge_id text,
  job_id uuid
)
language sql
security definer
set search_path = public
as $$
  select
    ledger_entries.id,
    ledger_entries.amount_cents,
    ledger_entries.driver_id,
    driver_connect_accounts.stripe_account_id,
    coalesce(job_tips.stripe_charge_id, job_payments.charge_id),
    ledger_entries.job_id
  from public.ledger_entries
  join public.jobs on jobs.id = ledger_entries.job_id
  join public.driver_connect_accounts
    on driver_connect_accounts.driver_id = ledger_entries.driver_id
    and driver_connect_accounts.payouts_enabled
    and driver_connect_accounts.transfers_active
    and driver_connect_accounts.livemode = target_livemode
  left join public.job_payments on job_payments.job_id = ledger_entries.job_id
  left join public.job_tips on job_tips.id = ledger_entries.tip_id
  where ledger_entries.status = 'ready'
    and ledger_entries.amount_cents > 0
    and ledger_entries.stripe_transfer_id is null
    and coalesce(job_payments.stripe_livemode, false) = target_livemode
    and (
      (ledger_entries.entry_kind = 'base' and job_payments.charge_id is not null)
      or (ledger_entries.entry_kind = 'tip' and job_tips.status = 'succeeded' and job_tips.stripe_charge_id is not null)
    )
    and not exists (
      select 1 from public.job_disputes
      where job_id = ledger_entries.job_id and payout_hold
    )
    and not exists (
      select 1 from public.card_disputes
      where job_id = ledger_entries.job_id and outcome is null
    );
$$;

create or replace function public.refresh_ledger_readiness()
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.ledger_entries as entry
  set status = case
      when exists (
        select 1 from public.job_disputes
        where job_id = entry.job_id and payout_hold
      ) then 'held'
      when exists (
        select 1 from public.card_disputes
        where job_id = entry.job_id and outcome is null
      ) then 'held'
      when not exists (
        select 1 from public.driver_connect_accounts
        where driver_id = entry.driver_id
          and payouts_enabled
          and transfers_active
          and livemode = coalesce((select stripe_livemode from public.job_payments where job_id = entry.job_id), false)
      ) then 'held_until_onboarding'
      when entry.amount_cents > 0
        and (
          entry.entry_kind = 'tip'
          or exists (
            select 1 from public.jobs
            where jobs.id = entry.job_id
              and (
                jobs.status = 'completed'
                or (jobs.status = 'cancelled' and jobs.payment_status = 'captured')
              )
              and (
                public.driver_completed_jobs(entry.driver_id) >= 5
                or coalesce(jobs.completed_at, jobs.updated_at) <= now() - interval '48 hours'
              )
          )
        ) then 'ready'
      else 'pending'
    end,
    hold_reason = case
      when exists (
        select 1 from public.job_disputes
        where job_id = entry.job_id and payout_hold
      ) then 'A problem report is open'
      when exists (
        select 1 from public.card_disputes
        where job_id = entry.job_id and outcome is null
      ) then 'A card dispute is open'
      when not exists (
        select 1 from public.driver_connect_accounts
        where driver_id = entry.driver_id
          and payouts_enabled
          and transfers_active
          and livemode = coalesce((select stripe_livemode from public.job_payments where job_id = entry.job_id), false)
      ) then 'Needs payout setup'
      when entry.entry_kind is distinct from 'tip'
        and public.driver_completed_jobs(entry.driver_id) < 5
        and exists (
          select 1 from public.jobs
          where jobs.id = entry.job_id
            and (
              jobs.status = 'completed'
              or (jobs.status = 'cancelled' and jobs.payment_status = 'captured')
            )
            and coalesce(jobs.completed_at, jobs.updated_at) > now() - interval '48 hours'
        ) then 'Earnings stay held for 48 hours after a new driver finishes a job'
      else null
    end,
    updated_at = now()
  where entry.status in ('pending', 'held', 'held_until_onboarding', 'ready')
    and entry.stripe_transfer_id is null
    and entry.external_method is null;
end;
$function$;

create or replace function public.post_driver_earnings(target_job uuid, available_on timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  amount integer;
  next_status text;
  reason text;
  payouts_on boolean;
begin
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.payment_status is distinct from 'captured' or job_row.assigned_driver_id is null then
    return;
  end if;
  if coalesce(job_row.late_cancel_cents, 0) > 0 then
    amount := coalesce(job_row.fee_driver_cents, 0);
  elsif job_row.status = 'cancelled' and coalesce(job_row.trip_fee_cents, 0) > 0 then
    amount := coalesce(job_row.fee_driver_cents, least(2000, job_row.trip_fee_cents));
  elsif job_row.status = 'completed' then
    amount := job_row.driver_pay_cents;
  else
    return;
  end if;
  if amount is null or amount <= 0 then
    return;
  end if;

  select coalesce(payouts_enabled, false) and coalesce(transfers_active, false) into payouts_on
  from public.driver_connect_accounts
  where driver_id = job_row.assigned_driver_id
    and livemode = coalesce((select stripe_livemode from public.job_payments where job_id = target_job), false);

  if exists (select 1 from public.job_disputes where job_id = target_job and payout_hold) then
    next_status := 'held';
    reason := 'A problem report is open';
  elsif exists (select 1 from public.card_disputes where job_id = target_job and outcome is null) then
    next_status := 'held';
    reason := 'A card dispute is open';
  elsif not coalesce(payouts_on, false) then
    next_status := 'held_until_onboarding';
    reason := 'Needs payout setup';
  elsif public.driver_completed_jobs(job_row.assigned_driver_id) < 5 then
    next_status := 'pending';
    reason := 'Earnings stay held for 48 hours after a new driver finishes a job';
  else
    next_status := 'pending';
    reason := null;
  end if;

  insert into public.ledger_entries (
    job_id, driver_id, amount_cents, status, hold_reason, available_on, entry_kind
  ) values (
    target_job, job_row.assigned_driver_id, amount, next_status, reason, available_on, 'base'
  )
  on conflict (job_id) where entry_kind = 'base' do update
    set amount_cents = excluded.amount_cents,
        updated_at = now()
    where public.ledger_entries.amount_cents is distinct from excluded.amount_cents
      and public.ledger_entries.entry_kind = 'base';
end;
$function$;

create or replace function public.confirm_tip_payment(
  target_tip uuid,
  payment_intent text,
  charge_id text,
  fee_cents integer,
  live boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  tip_row public.job_tips%rowtype;
  job_row public.jobs%rowtype;
  customer_name text;
  dollars text;
  net_cents integer;
  mode_live boolean;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  select payments_mode = 'live' into mode_live from public.platform_settings where id = 1;
  if coalesce(live, false) is distinct from coalesce(mode_live, false) then
    raise exception 'this tip does not match the payment mode';
  end if;
  select * into tip_row from public.job_tips where id = target_tip for update;
  if not found then
    raise exception 'tip not found';
  end if;
  if tip_row.stripe_payment_intent_id is not null and tip_row.stripe_payment_intent_id is distinct from payment_intent then
    raise exception 'this tip already has a payment';
  end if;
  if tip_row.paid_at is not null then
    if tip_row.stripe_fee_cents is null and fee_cents is not null then
      update public.job_tips
      set stripe_fee_cents = fee_cents, updated_at = now()
      where id = target_tip;
    end if;
    return 'duplicate';
  end if;
  select * into job_row from public.jobs where id = tip_row.job_id;
  if job_row.is_test and coalesce(live, false) then
    raise exception 'a test job cannot take a live charge';
  end if;
  net_cents := greatest(tip_row.amount_cents - tip_row.refunded_cents, 0);
  update public.job_tips
  set status = case
        when refunded_cents >= amount_cents then 'refunded'
        else 'succeeded'
      end,
      stripe_payment_intent_id = payment_intent,
      stripe_charge_id = charge_id,
      stripe_fee_cents = fee_cents,
      paid_at = now(),
      updated_at = now()
  where id = target_tip;
  insert into public.ledger_entries (
    job_id, driver_id, amount_cents, status, available_on, entry_kind, tip_id
  ) values (
    tip_row.job_id, tip_row.driver_id, net_cents, 'pending', now(), 'tip', target_tip
  )
  on conflict (tip_id) do nothing;
  if net_cents = 0 then
    return 'paid';
  end if;
  select coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'Your customer')
  into customer_name
  from public.profiles
  where id = tip_row.customer_id;
  dollars := case
    when net_cents % 100 = 0 then '$' || (net_cents / 100)::text
    else '$' || to_char(net_cents / 100.0, 'FM999990.00')
  end;
  perform public.enqueue_notification(
    tip_row.driver_id,
    tip_row.job_id,
    'tip',
    'You got a tip',
    'You got a ' || dollars || ' tip from ' || customer_name || '!',
    '/driver/earnings',
    'tip:' || target_tip::text
  );
  return 'paid';
end;
$$;

create or replace function public.activate_payments_mode(next_mode text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  previous text;
begin
  if not public.is_admin() then
    raise exception 'admin required';
  end if;
  if next_mode is distinct from 'test' and next_mode is distinct from 'live' then
    raise exception 'payment mode must be test or live';
  end if;
  select payments_mode into previous
  from public.platform_settings
  where id = 1
  for update;
  if previous is null then
    raise exception 'payment mode could not be saved';
  end if;
  if previous is distinct from next_mode then
    update public.platform_settings
    set payments_mode = next_mode
    where id = 1;
    insert into public.audit_log (actor_id, action, target_type, target_id, data)
    values (
      auth.uid(),
      'payments_mode_activated',
      'platform_settings',
      null,
      jsonb_build_object('from', previous, 'to', next_mode)
    );
  end if;
  return next_mode;
end;
$$;

revoke all on function public.activate_payments_mode(text) from public, anon, authenticated;
grant execute on function public.activate_payments_mode(text) to authenticated;
