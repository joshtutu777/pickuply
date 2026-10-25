-- Qualify the refund id argument so it does not clash with the column of the same name.
-- Do not apply this file to the hosted project until the owner approves it.

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
