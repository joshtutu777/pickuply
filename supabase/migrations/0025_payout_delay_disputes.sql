-- Payout delay can be a few seconds in tests. Card disputes are recorded without moving money by themselves.
-- Do not apply this file to the hosted project until the owner approves it.

alter table public.platform_settings
  add column payout_delay_seconds integer
  check (payout_delay_seconds is null or payout_delay_seconds >= 0);

create table public.card_disputes (
  stripe_dispute_id text primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  amount_cents integer,
  status text not null,
  outcome text,
  updated_at timestamptz not null default now()
);

alter table public.card_disputes enable row level security;

create policy card_disputes_admin on public.card_disputes
  for select to authenticated
  using (public.is_admin());

revoke all on public.card_disputes from public, anon, authenticated;
grant select on public.card_disputes to authenticated;

create or replace function public.refresh_ledger_readiness()
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  delay_hours integer;
  delay_seconds integer;
  wait_for interval;
begin
  select payout_delay_hours, payout_delay_seconds
  into delay_hours, delay_seconds
  from public.platform_settings
  where id = 1;
  wait_for := case
    when delay_seconds is not null then make_interval(secs => delay_seconds)
    else make_interval(hours => delay_hours)
  end;

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
        where driver_id = entry.driver_id and payouts_enabled
      ) then 'held_until_onboarding'
      when entry.available_on is not null
        and entry.available_on <= now()
        and entry.amount_cents > 0
        and exists (
          select 1 from public.jobs
          where jobs.id = entry.job_id
            and jobs.updated_at <= now() - wait_for
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
      when exists (
        select 1 from public.card_disputes
        where job_id = entry.job_id and outcome is null
      ) then 'A card dispute is open'
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

drop function if exists public.record_chargeback(uuid, text);

create or replace function public.record_chargeback(
  target_job uuid,
  dispute_id text,
  dispute_status text,
  amount_cents integer
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.card_disputes (stripe_dispute_id, job_id, amount_cents, status)
  values (dispute_id, target_job, amount_cents, coalesce(dispute_status, 'open'))
  on conflict (stripe_dispute_id) do update
    set status = excluded.status, amount_cents = coalesce(excluded.amount_cents, card_disputes.amount_cents), updated_at = now();

  update public.ledger_entries
  set status = case when status in ('transferred', 'externally_paid', 'recovered') then 'recovery_due' else 'held' end,
      hold_reason = 'A card dispute is open',
      updated_at = now()
  where job_id = target_job
    and status in ('pending', 'held', 'held_until_onboarding', 'ready', 'transferred');

  insert into public.recovery_obligations (ledger_id, job_id, driver_id, amount_cents, status, reason)
  select id, job_id, driver_id, public.ledger_entries.amount_cents, 'recovery_due', 'Card dispute'
  from public.ledger_entries
  where job_id = target_job and status = 'recovery_due'
    and not exists (
      select 1 from public.recovery_obligations
      where ledger_id = public.ledger_entries.id and status = 'recovery_due'
    );

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

create or replace function public.note_dispute_closed(dispute_id text, outcome text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job uuid;
begin
  update public.card_disputes
  set outcome = outcome, status = 'closed', updated_at = now()
  where stripe_dispute_id = dispute_id
  returning job_id into job;
  if job is null then
    return;
  end if;
  if outcome = 'won' then
    update public.ledger_entries
    set status = 'pending', hold_reason = null, updated_at = now()
    where job_id = job and status = 'held' and hold_reason = 'A card dispute is open';
  end if;
  perform public.notify_admins(
    job, 'chargeback',
    'Card dispute closed',
    'Stripe closed the dispute as ' || outcome || '. No earnings were deducted automatically.',
    '/admin/payments',
    'chargeback-closed:' || dispute_id
  );
end;
$function$;

create or replace function public.notify_ledger_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('held', 'held_until_onboarding') then
      perform public.enqueue_notification(
        new.driver_id, new.job_id, 'earnings_held',
        'Earnings held',
        coalesce(new.hold_reason, 'These earnings are held.'),
        '/driver/earnings',
        'earnings-held:' || new.id::text || ':' || new.status
      );
    end if;
    return new;
  end if;

  if new.status = 'transferred' and old.status is distinct from 'transferred' then
    perform public.enqueue_notification(
      new.driver_id, new.job_id, 'transfer_sent',
      'Transfer sent',
      'Stripe is sending your earnings to your payout account. This is not a bank deposit yet.',
      '/driver/earnings',
      'transfer-sent:' || new.id::text
    );
  elsif new.transfer_status = 'failed' and old.transfer_status is distinct from 'failed' then
    perform public.enqueue_notification(
      new.driver_id, new.job_id, 'transfer_failed',
      'Transfer not sent',
      coalesce(new.hold_reason, 'The transfer could not be sent. It will be tried again.'),
      '/driver/earnings',
      'transfer-failed:' || new.id::text
    );
    perform public.notify_admins(
      new.job_id, 'transfer_failed',
      'Transfer failed',
      coalesce(new.hold_reason, 'A driver transfer failed.'),
      '/admin/payouts',
      'transfer-failed-admin:' || new.id::text
    );
  elsif new.status = 'externally_paid' and old.status is distinct from 'externally_paid' then
    perform public.enqueue_notification(
      new.driver_id, new.job_id, 'external_payment',
      'Paid outside Stripe',
      'An admin recorded this earning as paid outside Stripe.',
      '/driver/earnings',
      'external-payment:' || new.id::text
    );
  elsif new.status in ('held', 'held_until_onboarding') and old.status is distinct from new.status then
    perform public.enqueue_notification(
      new.driver_id, new.job_id, 'earnings_held',
      'Earnings held',
      coalesce(new.hold_reason, 'These earnings are held.'),
      '/driver/earnings',
      'earnings-held:' || new.id::text || ':' || new.status
    );
  end if;
  return new;
end;
$$;

create trigger ledger_notify
  after insert or update on public.ledger_entries
  for each row execute function public.notify_ledger_change();

create or replace function public.notify_refund_recorded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  customer uuid;
begin
  if new.status = 'succeeded' and old.status is distinct from 'succeeded' then
    select customer_id into customer from public.jobs where id = new.job_id;
    perform public.enqueue_notification(
      customer, new.job_id, 'refunded',
      'Refund recorded',
      'A refund was recorded for this job.',
      '/jobs/' || new.job_id::text,
      'refunded:' || new.id::text
    );
  end if;
  return new;
end;
$$;

create trigger refund_notify
  after update on public.refund_requests
  for each row execute function public.notify_refund_recorded();

revoke all on function public.record_chargeback(uuid, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.record_chargeback(uuid, text, text, integer) to service_role;

revoke all on function public.note_dispute_closed(text, text) from public, anon, authenticated, service_role;
grant execute on function public.note_dispute_closed(text, text) to service_role;

drop function public.overdue_payment_jobs();

create function public.overdue_payment_jobs()
returns table (job_id uuid, payment_intent_id text, checkout_session_id text)
language sql
security definer
set search_path = public
as $$
  select jobs.id, job_payments.payment_intent_id, job_payments.checkout_session_id
  from public.jobs
  left join public.job_payments on job_payments.job_id = jobs.id
  where jobs.status = 'assigned'
    and jobs.payment_status in ('awaiting_payment', 'failed')
    and jobs.payment_due_at < now();
$$;

revoke all on function public.overdue_payment_jobs() from public, anon, authenticated, service_role;
grant execute on function public.overdue_payment_jobs() to service_role;

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
    )
    and not exists (
      select 1 from public.card_disputes
      where job_id = ledger_entries.job_id and outcome is null
    );
$$;
