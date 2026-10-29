-- Transfers use the job charge, so they do not wait for that charge to become available.
-- A new driver still waits 48 hours. An open report or dispute still holds the transfer.
-- Payouts are ready only when Stripe says payouts are enabled and transfers are active.
-- Do not apply this file to the hosted project until the owner approves it.

alter table public.driver_connect_accounts
  add column transfers_active boolean not null default false;

drop function if exists public.upsert_connect_account(uuid, text, boolean, boolean, boolean, text[], text);

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
  if target_driver is null or account_id is null or account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception 'a Stripe account id is required';
  end if;
  if not exists (select 1 from public.drivers where profile_id = target_driver) then
    raise exception 'that person is not a driver';
  end if;

  insert into public.driver_connect_accounts (
    driver_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted,
    requirements_due, disabled_reason, transfers_active, synced_at
  ) values (
    target_driver, account_id, coalesce(charges_enabled, false), coalesce(payouts_enabled, false),
    coalesce(details_submitted, false), coalesce(requirements_due, '{}'), nullif(disabled_reason, ''),
    coalesce(transfers_active, false), now()
  )
  on conflict (driver_id) do update
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
    where driver_id = target_driver and stripe_account_id = account_id
  ) then
    raise exception 'this driver already has a different payout account';
  end if;
end;
$$;

revoke all on function public.upsert_connect_account(uuid, text, boolean, boolean, boolean, text[], text, boolean)
  from public, anon, authenticated;
grant execute on function public.upsert_connect_account(uuid, text, boolean, boolean, boolean, text[], text, boolean)
  to service_role;

create or replace function public.my_payout_wait()
returns interval
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return null;
  end if;
  if public.driver_completed_jobs(auth.uid()) < 5 then
    return interval '48 hours';
  end if;
  return interval '0';
end;
$$;

revoke all on function public.my_payout_wait() from public, anon, service_role;
grant execute on function public.my_payout_wait() to authenticated;

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

drop function if exists public.ready_transfers();

create or replace function public.ready_transfers()
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
  left join public.job_payments on job_payments.job_id = ledger_entries.job_id
  left join public.job_tips on job_tips.id = ledger_entries.tip_id
  where ledger_entries.status = 'ready'
    and ledger_entries.amount_cents > 0
    and ledger_entries.stripe_transfer_id is null
    and coalesce(job_payments.stripe_livemode, false) = false
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

revoke all on function public.ready_transfers() from public, anon, authenticated;
grant execute on function public.ready_transfers() to service_role;

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
  where driver_id = job_row.assigned_driver_id;

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

-- A missing capability returns the claim to open. The ledger id stays the idempotency key.
create or replace function public.note_transfer_needs_setup(target_entry uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.ledger_entries
  set status = 'held_until_onboarding',
      hold_reason = 'Needs payout setup',
      transfer_status = null,
      updated_at = now()
  where id = target_entry
    and stripe_transfer_id is null
    and status in ('ready', 'pending', 'held_until_onboarding');

  update public.stripe_transfer_claims
  set state = 'open', updated_at = now()
  where ledger_id = target_entry
    and stripe_transfer_id is null
    and state in ('open', 'sending', 'ambiguous');
end;
$function$;

revoke all on function public.note_transfer_needs_setup(uuid) from public, anon, authenticated;
grant execute on function public.note_transfer_needs_setup(uuid) to service_role;
