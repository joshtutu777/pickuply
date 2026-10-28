-- Read-only payment checks for an admin. No amounts are changed.
-- Do not apply this file to the hosted project until the owner approves it.

create or replace function public.payment_reconciliation_issues()
returns table (job_id uuid, issue text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    return;
  end if;
  if auth.uid() is null and session_user not in ('postgres', 'supabase_admin', 'service_role') then
    return;
  end if;

  return query
  select jobs.id, 'captured payment has no driver earnings'::text
  from public.jobs
  where jobs.payment_status = 'captured'
    and coalesce(jobs.driver_pay_cents, 0) > 0
    and not exists (
      select 1 from public.ledger_entries where ledger_entries.job_id = jobs.id
    )
  union all
  select ledger_entries.job_id, 'transferred earnings have no Stripe transfer'::text
  from public.ledger_entries
  where ledger_entries.status = 'transferred'
    and ledger_entries.stripe_transfer_id is null
  union all
  select ledger_entries.job_id, 'the same Stripe transfer is recorded twice'::text
  from public.ledger_entries
  where ledger_entries.stripe_transfer_id is not null
    and ledger_entries.stripe_transfer_id in (
      select stripe_transfer_id
      from public.ledger_entries
      where stripe_transfer_id is not null
      group by stripe_transfer_id
      having count(*) > 1
    )
  union all
  select jobs.id, 'captured payment has no captured amount'::text
  from public.jobs
  where jobs.payment_status = 'captured'
    and coalesce(jobs.captured_cents, 0) <= 0
  union all
  select jobs.id, 'authorized job has no PaymentIntent'::text
  from public.jobs
  left join public.job_payments on job_payments.job_id = jobs.id
  where jobs.payment_status = 'authorized'
    and job_payments.payment_intent_id is null
  union all
  select jobs.id, 'refunded amount is larger than the captured amount'::text
  from public.jobs
  where jobs.refunded_cents > coalesce(jobs.captured_cents, 0)
    and jobs.refunded_cents > 0;
end;
$$;

revoke all on function public.payment_reconciliation_issues() from public, anon, authenticated, service_role;
grant execute on function public.payment_reconciliation_issues() to authenticated, service_role;
