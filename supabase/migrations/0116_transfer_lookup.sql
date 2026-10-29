-- A failed transfer lookup is counted. It is not left unknown forever.
-- After three failures the sender may create with the same ledger id.
-- Do not apply this file to the hosted project until the owner approves it.

alter table public.stripe_transfer_claims
  add column lookup_failures integer not null default 0,
  add column last_lookup_error text,
  add column first_attempt_at timestamptz;

update public.stripe_transfer_claims
set first_attempt_at = updated_at
where first_attempt_at is null
  and state <> 'open';

alter table public.stripe_transfer_claims
  add constraint stripe_transfer_claims_lookup_failures check (lookup_failures >= 0),
  add constraint stripe_transfer_claims_lookup_error check (
    last_lookup_error is null or char_length(last_lookup_error) <= 300
  );

create or replace function public.note_transfer_lookup_failure(target_entry uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  next_count integer;
  first_at timestamptz;
begin
  update public.stripe_transfer_claims
  set lookup_failures = lookup_failures + 1,
      last_lookup_error = left(btrim(coalesce(reason, 'lookup failed')), 300),
      first_attempt_at = coalesce(first_attempt_at, now()),
      updated_at = now()
  where ledger_id = target_entry
    and stripe_transfer_id is null
  returning lookup_failures, first_attempt_at into next_count, first_at;
  if next_count is null then
    raise exception 'transfer claim not found';
  end if;
  return jsonb_build_object('failures', next_count, 'first_attempt_at', first_at);
end;
$function$;

revoke all on function public.note_transfer_lookup_failure(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.note_transfer_lookup_failure(uuid, text) to service_role;

-- The 23-hour window starts at the first attempt, not the latest status change.
create or replace function public.begin_transfer_send(target_entry uuid, confirm_absent boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  entry public.ledger_entries%rowtype;
  claim public.stripe_transfer_claims%rowtype;
  won uuid;
  attempt_at timestamptz;
begin
  select * into entry from public.ledger_entries where id = target_entry for update;
  if not found then
    raise exception 'ledger row not found';
  end if;
  if entry.stripe_transfer_id is not null then
    return jsonb_build_object(
      'action', 'recorded',
      'transfer_id', entry.stripe_transfer_id,
      'idempotency_key', target_entry::text
    );
  end if;

  insert into public.stripe_transfer_claims (ledger_id, idempotency_key, state)
  values (target_entry, target_entry::text, 'open')
  on conflict (ledger_id) do nothing;

  select * into claim from public.stripe_transfer_claims where ledger_id = target_entry for update;
  if claim.stripe_transfer_id is not null then
    perform public.mark_transferred(target_entry, claim.stripe_transfer_id);
    update public.stripe_transfer_claims
    set state = 'recorded', updated_at = now()
    where ledger_id = target_entry;
    return jsonb_build_object(
      'action', 'recorded',
      'transfer_id', claim.stripe_transfer_id,
      'idempotency_key', claim.idempotency_key
    );
  end if;

  attempt_at := coalesce(claim.first_attempt_at, claim.updated_at);
  update public.stripe_transfer_claims
  set state = 'sending',
      first_attempt_at = coalesce(first_attempt_at, now()),
      updated_at = now()
  where ledger_id = target_entry
    and stripe_transfer_id is null
    and (
      state = 'open'
      or (
        confirm_absent
        and attempt_at > now() - interval '23 hours'
        and (
          state = 'ambiguous'
          or (state = 'sending' and updated_at <= now() - interval '2 minutes')
        )
      )
    )
  returning ledger_id into won;

  if won is not null then
    return jsonb_build_object('action', 'send', 'transfer_id', null, 'idempotency_key', target_entry::text);
  end if;
  if confirm_absent
    and claim.state in ('ambiguous', 'sending')
    and attempt_at <= now() - interval '23 hours' then
    return jsonb_build_object('action', 'reconcile', 'transfer_id', null, 'idempotency_key', target_entry::text);
  end if;
  return jsonb_build_object('action', 'lookup', 'transfer_id', null, 'idempotency_key', target_entry::text);
end;
$function$;

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
    and jobs.refunded_cents > 0
  union all
  select ledger_entries.job_id, 'a transfer attempt has no recorded Stripe transfer'::text
  from public.stripe_transfer_claims
  join public.ledger_entries on ledger_entries.id = stripe_transfer_claims.ledger_id
  where stripe_transfer_claims.stripe_transfer_id is null
    and stripe_transfer_claims.state in ('ambiguous', 'sending')
    and coalesce(stripe_transfer_claims.first_attempt_at, stripe_transfer_claims.updated_at) <= now() - interval '23 hours';
end;
$$;
