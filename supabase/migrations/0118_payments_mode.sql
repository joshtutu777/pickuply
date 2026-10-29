-- Payments mode is test until the server copies PAYMENTS_MODE=live into this row.
-- The browser cannot set it. ready_transfers selects charges that match the mode.
-- In live mode a real driver needs payouts and transfers before accepting a job.

alter table public.platform_settings
  add column if not exists payments_mode text not null default 'test';

alter table public.platform_settings
  drop constraint if exists platform_settings_payments_mode;

alter table public.platform_settings
  add constraint platform_settings_payments_mode check (payments_mode in ('test', 'live'));

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

revoke all on function public.assert_driver_can_take_job(uuid, text) from public, anon, service_role;
grant execute on function public.assert_driver_can_take_job(uuid, text) to authenticated;

drop function if exists public.ready_transfers();

create function public.ready_transfers(target_livemode boolean default false)
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

revoke all on function public.ready_transfers(boolean) from public, anon, authenticated;
grant execute on function public.ready_transfers(boolean) to service_role;
