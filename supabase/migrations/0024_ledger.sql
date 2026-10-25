-- Driver earnings ledger, transfers, refunds, and recovery.
-- Junk disposal is not a ledger line. A transfer is not a bank payout.
-- Do not apply this file to the hosted project until the owner approves it.

alter table public.platform_settings
  add column payout_delay_hours integer not null default 24
  check (payout_delay_hours between 0 and 168);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs (id) on delete cascade,
  driver_id uuid not null references public.profiles (id),
  amount_cents integer not null check (amount_cents >= 0),
  status text not null,
  hold_reason text,
  available_on timestamptz,
  stripe_transfer_id text,
  transfer_status text,
  external_method text,
  external_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledger_status check (
    status in (
      'pending', 'held', 'held_until_onboarding', 'ready', 'transferred',
      'externally_paid', 'recovery_due', 'recovered'
    )
  ),
  constraint ledger_transfer_status check (
    transfer_status is null or transfer_status in ('created', 'reversed', 'failed')
  ),
  constraint ledger_transfer_id check (
    stripe_transfer_id is null or stripe_transfer_id ~ '^tr_[A-Za-z0-9]+$'
  )
);

create table public.recovery_obligations (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledger_entries (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  driver_id uuid not null references public.profiles (id),
  amount_cents integer not null check (amount_cents > 0),
  status text not null check (status in ('recovery_due', 'recovered')),
  reason text not null,
  method text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  reason text not null,
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  stripe_refund_id text unique,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.driver_bank_payouts (
  stripe_payout_id text primary key,
  driver_id uuid not null references public.profiles (id),
  amount_cents integer,
  status text not null check (status in ('pending', 'paid', 'failed')),
  created_at timestamptz not null default now()
);

alter table public.ledger_entries enable row level security;
alter table public.recovery_obligations enable row level security;
alter table public.refund_requests enable row level security;
alter table public.driver_bank_payouts enable row level security;

create policy ledger_read on public.ledger_entries
  for select to authenticated
  using (driver_id = auth.uid() or public.is_admin());

create policy recovery_read on public.recovery_obligations
  for select to authenticated
  using (driver_id = auth.uid() or public.is_admin());

create policy refund_read on public.refund_requests
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.jobs
      where jobs.id = refund_requests.job_id and jobs.customer_id = auth.uid()
    )
  );

create policy bank_payout_read on public.driver_bank_payouts
  for select to authenticated
  using (driver_id = auth.uid() or public.is_admin());

revoke all on public.ledger_entries from public, anon, authenticated;
revoke all on public.recovery_obligations from public, anon, authenticated;
revoke all on public.refund_requests from public, anon, authenticated;
revoke all on public.driver_bank_payouts from public, anon, authenticated;
grant select on public.ledger_entries to authenticated;
grant select on public.recovery_obligations to authenticated;
grant select on public.refund_requests to authenticated;
grant select on public.driver_bank_payouts to authenticated;

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
  if job_row.status = 'cancelled' then
    amount := job_row.trip_fee_cents;
  elsif job_row.status = 'completed' then
    amount := job_row.driver_pay_cents;
  else
    return;
  end if;
  if amount is null or amount <= 0 then
    return;
  end if;

  select coalesce(payouts_enabled, false) into payouts_on
  from public.driver_connect_accounts
  where driver_id = job_row.assigned_driver_id;

  if exists (select 1 from public.job_disputes where job_id = target_job and payout_hold) then
    next_status := 'held';
    reason := 'A problem report is open';
  elsif not coalesce(payouts_on, false) then
    next_status := 'held_until_onboarding';
    reason := 'Finish payout setup before a transfer can be sent';
  else
    next_status := 'pending';
    reason := 'Waiting for the payout delay and for the card payment to become available';
  end if;

  insert into public.ledger_entries (job_id, driver_id, amount_cents, status, hold_reason, available_on)
  values (target_job, job_row.assigned_driver_id, amount, next_status, reason, available_on)
  on conflict (job_id) do update
    set available_on = coalesce(public.ledger_entries.available_on, excluded.available_on),
        updated_at = now()
    where public.ledger_entries.available_on is null and excluded.available_on is not null;
end;
$function$;

create or replace function public.refresh_ledger_readiness()
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  delay_hours integer;
begin
  select payout_delay_hours into delay_hours from public.platform_settings where id = 1;
  update public.ledger_entries as entry
  set status = case
      when exists (
        select 1 from public.job_disputes
        where job_id = entry.job_id and payout_hold
      ) then 'held'
      when not exists (
        select 1 from public.driver_connect_accounts
        where driver_id = entry.driver_id and payouts_enabled
      ) then 'held_until_onboarding'
      when entry.available_on is not null
        and entry.available_on <= now()
        and entry.amount_cents > 0
        and exists (
          select 1 from public.jobs
          where jobs.id = entry.job_id
            and jobs.updated_at <= now() - make_interval(hours => delay_hours)
            and (
              jobs.status = 'completed'
              or (jobs.status = 'cancelled' and jobs.payment_status = 'captured')
            )
        ) then 'ready'
      else 'pending'
    end,
    hold_reason = case
      when exists (
        select 1 from public.job_disputes
        where job_id = entry.job_id and payout_hold
      ) then 'A problem report is open'
      when not exists (
        select 1 from public.driver_connect_accounts
        where driver_id = entry.driver_id and payouts_enabled
      ) then 'Finish payout setup before a transfer can be sent'
      when entry.available_on is null then 'Waiting for the card payment to become available'
      else null
    end,
    updated_at = now()
  where entry.status in ('pending', 'held', 'held_until_onboarding', 'ready')
    and entry.stripe_transfer_id is null
    and entry.external_method is null;
end;
$function$;

create or replace function public.ready_transfers()
returns table (
  entry_id uuid,
  amount_cents integer,
  driver_id uuid,
  stripe_account_id text,
  charge_id text
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
    job_payments.charge_id
  from public.ledger_entries
  join public.driver_connect_accounts
    on driver_connect_accounts.driver_id = ledger_entries.driver_id
    and driver_connect_accounts.payouts_enabled
  join public.job_payments on job_payments.job_id = ledger_entries.job_id
  where ledger_entries.status = 'ready'
    and ledger_entries.amount_cents > 0
    and ledger_entries.stripe_transfer_id is null
    and job_payments.charge_id is not null
    and not exists (
      select 1 from public.job_disputes
      where job_id = ledger_entries.job_id and payout_hold
    );
$$;

create or replace function public.mark_transferred(target_entry uuid, transfer_id text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if transfer_id is null or transfer_id !~ '^tr_[A-Za-z0-9]+$' then
    raise exception 'transfer id is missing';
  end if;
  update public.ledger_entries
  set status = 'transferred',
      stripe_transfer_id = transfer_id,
      transfer_status = 'created',
      hold_reason = null,
      updated_at = now()
  where id = target_entry
    and stripe_transfer_id is null
    and status in ('ready', 'pending');
end;
$function$;

create or replace function public.mark_transfer_failed(target_entry uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.ledger_entries
  set transfer_status = 'failed',
      hold_reason = left(coalesce(reason, 'The transfer could not be sent.'), 300),
      updated_at = now()
  where id = target_entry and status = 'ready' and stripe_transfer_id is null;
end;
$function$;

create or replace function public.note_transfer_status(transfer_id text, next_status text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if next_status not in ('created', 'reversed', 'failed') then
    return;
  end if;
  update public.ledger_entries
  set transfer_status = next_status, updated_at = now()
  where stripe_transfer_id = transfer_id;
end;
$function$;

create or replace function public.record_bank_payout(
  account_id text,
  payout_id text,
  payout_status text,
  amount_cents integer
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  driver uuid;
begin
  if payout_status not in ('pending', 'paid', 'failed') then
    return;
  end if;
  select driver_id into driver from public.driver_connect_accounts where stripe_account_id = account_id;
  if driver is null then
    return;
  end if;
  insert into public.driver_bank_payouts (stripe_payout_id, driver_id, amount_cents, status)
  values (payout_id, driver, amount_cents, payout_status)
  on conflict (stripe_payout_id) do update
    set status = excluded.status, amount_cents = excluded.amount_cents;
end;
$function$;

create or replace function public.begin_refund(target_job uuid, amount_cents integer, reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  payment_row public.job_payments%rowtype;
  refund_id uuid;
  moved boolean;
begin
  if not public.is_admin() then
    raise exception 'only an admin can refund';
  end if;
  if amount_cents is null or amount_cents <= 0 or length(btrim(coalesce(reason, ''))) < 3 then
    raise exception 'enter an amount and a reason';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found then
    raise exception 'job not found';
  end if;
  select * into payment_row from public.job_payments where job_id = target_job;

  if job_row.payment_status = 'authorized' then
    if amount_cents is distinct from job_row.price_cents then
      raise exception 'a refund before capture releases the whole hold';
    end if;
    return jsonb_build_object('outcome', 'release', 'payment_intent_id', payment_row.payment_intent_id);
  end if;

  if job_row.payment_status is distinct from 'captured' or payment_row.charge_id is null then
    raise exception 'this payment cannot be refunded';
  end if;
  if amount_cents > job_row.captured_cents - job_row.refunded_cents then
    raise exception 'that refund is larger than the remaining charge';
  end if;

  insert into public.refund_requests (job_id, amount_cents, reason, status, created_by)
  values (target_job, amount_cents, left(btrim(reason), 500), 'pending', auth.uid())
  returning id into refund_id;
  select exists (
    select 1 from public.ledger_entries
    where job_id = target_job and status = 'transferred'
  ) into moved;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(), 'request_refund', 'job', target_job,
    jsonb_build_object('refund_id', refund_id, 'amount_cents', amount_cents)
  );
  return jsonb_build_object(
    'outcome', 'refund',
    'refund_id', refund_id,
    'charge_id', payment_row.charge_id,
    'amount_cents', amount_cents,
    'transferred', moved
  );
end;
$function$;

create or replace function public.apply_refund(target_refund uuid, stripe_refund_id text, succeeded boolean)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  request_row public.refund_requests%rowtype;
  entry public.ledger_entries%rowtype;
begin
  select * into request_row from public.refund_requests where id = target_refund for update;
  if not found or request_row.status = 'succeeded' then
    return;
  end if;
  if not succeeded then
    update public.refund_requests set status = 'failed', stripe_refund_id = stripe_refund_id where id = target_refund;
    return;
  end if;
  update public.refund_requests
  set status = 'succeeded', stripe_refund_id = stripe_refund_id
  where id = target_refund;
  perform set_config('pickuply.system_payment', 'yes', true);
  update public.jobs
  set refunded_cents = refunded_cents + request_row.amount_cents
  where id = request_row.job_id;

  select * into entry from public.ledger_entries where job_id = request_row.job_id for update;
  if not found then
    return;
  end if;
  if entry.status = 'transferred' then
    update public.ledger_entries
    set status = 'recovery_due', hold_reason = 'Refunded after the transfer. Recovery needs an admin.', updated_at = now()
    where id = entry.id;
    insert into public.recovery_obligations (ledger_id, job_id, driver_id, amount_cents, status, reason)
    values (
      entry.id, entry.job_id, entry.driver_id, request_row.amount_cents, 'recovery_due', request_row.reason
    );
  else
    update public.ledger_entries
    set amount_cents = greatest(amount_cents - request_row.amount_cents, 0), updated_at = now()
    where id = entry.id and status in ('pending', 'held', 'held_until_onboarding', 'ready');
  end if;
end;
$function$;

create or replace function public.record_external_payment(
  target_entry uuid,
  method text,
  reference text,
  reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  entry public.ledger_entries%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can record an external payment';
  end if;
  if length(btrim(coalesce(method, ''))) < 2 or length(btrim(coalesce(reason, ''))) < 3 then
    raise exception 'enter the method and a reason';
  end if;
  select * into entry from public.ledger_entries where id = target_entry for update;
  if not found or entry.status in ('transferred', 'externally_paid', 'recovered') then
    raise exception 'this earning cannot be marked paid outside Stripe';
  end if;
  if exists (select 1 from public.job_disputes where job_id = entry.job_id and payout_hold) then
    raise exception 'payout is on hold while this job is disputed';
  end if;
  update public.ledger_entries
  set status = 'externally_paid',
      external_method = left(btrim(method), 40),
      external_reference = nullif(left(btrim(coalesce(reference, '')), 80), ''),
      hold_reason = null,
      updated_at = now()
  where id = target_entry;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(), 'record_external_payment', 'ledger_entry', target_entry,
    jsonb_build_object('method', method, 'reference', reference, 'reason', left(btrim(reason), 500))
  );
end;
$function$;

create or replace function public.record_chargeback(target_job uuid, dispute_id text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.ledger_entries
  set status = case when status in ('transferred', 'externally_paid', 'recovered') then 'recovery_due' else 'held' end,
      hold_reason = 'A card dispute is open',
      updated_at = now()
  where job_id = target_job
    and status in ('pending', 'held', 'held_until_onboarding', 'ready', 'transferred');
  if found and exists (
    select 1 from public.ledger_entries where job_id = target_job and status = 'recovery_due'
  ) then
    insert into public.recovery_obligations (ledger_id, job_id, driver_id, amount_cents, status, reason)
    select id, job_id, driver_id, amount_cents, 'recovery_due', 'Card dispute'
    from public.ledger_entries
    where job_id = target_job and status = 'recovery_due'
      and not exists (
        select 1 from public.recovery_obligations
        where ledger_id = ledger_entries.id and status = 'recovery_due'
      );
  end if;
  update public.jobs set status = 'disputed' where id = target_job and status is distinct from 'disputed';
  perform public.notify_admins(
    target_job, 'chargeback',
    'Card dispute opened',
    'Stripe opened a dispute. Earnings are on hold. Money that already moved is not reversed automatically.',
    '/admin/requests/' || target_job::text,
    'chargeback:' || coalesce(dispute_id, target_job::text)
  );
end;
$function$;

create or replace function public.mark_recovery(
  target_obligation uuid,
  method text,
  reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  row public.recovery_obligations%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can record a recovery';
  end if;
  if method not in ('reversal', 'deduction', 'recorded') or length(btrim(coalesce(reason, ''))) < 3 then
    raise exception 'choose how it was recovered and add a reason';
  end if;
  select * into row from public.recovery_obligations where id = target_obligation for update;
  if not found or row.status is distinct from 'recovery_due' then
    raise exception 'this recovery is already closed';
  end if;
  update public.recovery_obligations
  set status = 'recovered', method = method, resolved_at = now()
  where id = target_obligation;
  update public.ledger_entries
  set status = 'recovered', updated_at = now()
  where id = row.ledger_id and status = 'recovery_due';
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(), 'mark_recovery', 'recovery_obligation', target_obligation,
    jsonb_build_object('method', method, 'reason', left(btrim(reason), 500))
  );
end;
$function$;

create or replace function public.apply_recovery_deduction(
  target_obligation uuid,
  target_entry uuid,
  reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  obligation public.recovery_obligations%rowtype;
  entry public.ledger_entries%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can deduct a recovery';
  end if;
  if length(btrim(coalesce(reason, ''))) < 3 then
    raise exception 'add a short reason';
  end if;
  select * into obligation from public.recovery_obligations where id = target_obligation for update;
  select * into entry from public.ledger_entries where id = target_entry for update;
  if obligation.status is distinct from 'recovery_due' or entry.driver_id is distinct from obligation.driver_id then
    raise exception 'choose an open recovery and a future earning for the same driver';
  end if;
  if entry.status not in ('pending', 'held', 'held_until_onboarding', 'ready') or entry.amount_cents < obligation.amount_cents then
    raise exception 'that earning cannot cover the recovery';
  end if;
  update public.ledger_entries
  set amount_cents = amount_cents - obligation.amount_cents, updated_at = now()
  where id = target_entry;
  perform public.mark_recovery(target_obligation, 'deduction', reason);
end;
$function$;

revoke all on function public.post_driver_earnings(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.post_driver_earnings(uuid, timestamptz) to service_role;
revoke all on function public.refresh_ledger_readiness() from public, anon, authenticated, service_role;
grant execute on function public.refresh_ledger_readiness() to service_role;
revoke all on function public.ready_transfers() from public, anon, authenticated, service_role;
grant execute on function public.ready_transfers() to service_role;
revoke all on function public.mark_transferred(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mark_transferred(uuid, text) to service_role;
revoke all on function public.mark_transfer_failed(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mark_transfer_failed(uuid, text) to service_role;
revoke all on function public.note_transfer_status(text, text) from public, anon, authenticated, service_role;
grant execute on function public.note_transfer_status(text, text) to service_role;
revoke all on function public.record_bank_payout(text, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.record_bank_payout(text, text, text, integer) to service_role;
revoke all on function public.begin_refund(uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.begin_refund(uuid, integer, text) to authenticated;
revoke all on function public.apply_refund(uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.apply_refund(uuid, text, boolean) to service_role;
revoke all on function public.record_external_payment(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.record_external_payment(uuid, text, text, text) to authenticated;
revoke all on function public.record_chargeback(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.record_chargeback(uuid, text) to service_role;
revoke all on function public.mark_recovery(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.mark_recovery(uuid, text, text) to authenticated;
revoke all on function public.apply_recovery_deduction(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.apply_recovery_deduction(uuid, uuid, text) to authenticated;
