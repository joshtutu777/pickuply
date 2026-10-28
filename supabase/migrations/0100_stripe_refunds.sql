-- Record a Stripe Dashboard refund without reversing a transfer automatically.
-- Do not apply this file to the hosted project until the owner approves it.

create table public.stripe_refunds (
  stripe_refund_id text primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  created_at timestamptz not null default now(),
  constraint stripe_refunds_id_shape check (stripe_refund_id ~ '^re_[A-Za-z0-9]+$')
);

alter table public.stripe_refunds enable row level security;

create policy stripe_refunds_admin_read on public.stripe_refunds
  for select to authenticated
  using (public.is_admin());

grant select on public.stripe_refunds to authenticated;

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
    update public.refund_requests
    set status = 'failed', stripe_refund_id = apply_refund.stripe_refund_id
    where id = target_refund;
    return;
  end if;
  update public.refund_requests
  set status = 'succeeded', stripe_refund_id = apply_refund.stripe_refund_id
  where id = target_refund;
  perform public.apply_refund_to_job(request_row.job_id, request_row.amount_cents, request_row.reason);
end;
$function$;

create or replace function public.apply_refund_to_job(target_job uuid, amount_cents integer, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  entry public.ledger_entries%rowtype;
begin
  if amount_cents is null or amount_cents <= 0 then
    raise exception 'refund amount is missing';
  end if;
  perform set_config('pickuply.system_payment', 'yes', true);
  select * into job_row from public.jobs where id = target_job for update;
  if not found then
    raise exception 'job not found';
  end if;
  if coalesce(job_row.captured_cents, 0) <= 0 or job_row.payment_status not in ('captured', 'refunded') then
    raise exception 'this payment cannot be refunded';
  end if;
  if amount_cents > job_row.captured_cents - job_row.refunded_cents then
    raise exception 'that refund is larger than the remaining charge';
  end if;
  update public.jobs
  set refunded_cents = refunded_cents + amount_cents,
      payment_status = case
        when refunded_cents + amount_cents >= captured_cents then 'refunded'
        else payment_status
      end
  where id = target_job;

  select * into entry from public.ledger_entries where job_id = target_job for update;
  if not found then
    return;
  end if;
  if entry.status in ('transferred', 'externally_paid', 'recovery_due', 'recovered') then
    if entry.status in ('transferred', 'recovered') then
      update public.ledger_entries
      set status = 'recovery_due',
          hold_reason = 'Refunded after the transfer. Recovery needs an admin.',
          updated_at = now()
      where id = entry.id;
    end if;
    insert into public.recovery_obligations (ledger_id, job_id, driver_id, amount_cents, status, reason)
    values (
      entry.id, entry.job_id, entry.driver_id, amount_cents, 'recovery_due',
      left(coalesce(nullif(btrim(reason), ''), 'Recorded from Stripe'), 500)
    );
  else
    update public.ledger_entries
    set amount_cents = greatest(ledger_entries.amount_cents - apply_refund_to_job.amount_cents, 0), updated_at = now()
    where id = entry.id and status in ('pending', 'held', 'held_until_onboarding', 'ready');
  end if;
  insert into public.job_events (job_id, actor_id, type, data)
  values (
    target_job, null, 'stripe_refund',
    jsonb_build_object('amount_cents', amount_cents, 'reason', left(coalesce(reason, ''), 500))
  );
end;
$function$;

drop function if exists public.record_stripe_refund(uuid, text, integer, boolean);

create or replace function public.record_stripe_refund(
  target_job uuid,
  external_refund_id text,
  amount_cents integer,
  succeeded boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  existing public.stripe_refunds%rowtype;
begin
  if external_refund_id is null or external_refund_id !~ '^re_[A-Za-z0-9]+$' then
    raise exception 'refund id is missing';
  end if;
  if exists (
    select 1 from public.refund_requests
    where refund_requests.stripe_refund_id = external_refund_id
      and status = 'succeeded'
  ) then
    return;
  end if;

  select * into existing from public.stripe_refunds
  where stripe_refunds.stripe_refund_id = external_refund_id
  for update;
  if found and existing.status = 'succeeded' then
    return;
  end if;
  if not succeeded then
    insert into public.stripe_refunds (stripe_refund_id, job_id, amount_cents, status)
    values (external_refund_id, target_job, amount_cents, 'failed')
    on conflict (stripe_refund_id) do update
      set status = 'failed'
      where stripe_refunds.status <> 'succeeded';
    return;
  end if;

  perform public.apply_refund_to_job(target_job, amount_cents, 'Recorded from Stripe');
  insert into public.stripe_refunds (stripe_refund_id, job_id, amount_cents, status)
  values (external_refund_id, target_job, amount_cents, 'succeeded')
  on conflict (stripe_refund_id) do update
    set status = 'succeeded', amount_cents = excluded.amount_cents;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    null, 'record_stripe_refund', 'job', target_job,
    jsonb_build_object('stripe_refund_id', external_refund_id, 'amount_cents', amount_cents)
  );
end;
$function$;

revoke all on function public.apply_refund_to_job(uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.record_stripe_refund(uuid, text, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.record_stripe_refund(uuid, text, integer, boolean) to service_role;
