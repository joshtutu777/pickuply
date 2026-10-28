-- One Stripe transfer per ledger row. A lost response must not create another transfer.
-- Do not apply this file to the hosted project until the owner approves it.

create unique index ledger_entries_one_transfer
  on public.ledger_entries (stripe_transfer_id)
  where stripe_transfer_id is not null;

create table public.stripe_transfer_claims (
  ledger_id uuid primary key references public.ledger_entries (id) on delete cascade,
  idempotency_key text not null unique,
  stripe_transfer_id text unique,
  state text not null default 'open',
  updated_at timestamptz not null default now(),
  constraint stripe_transfer_claims_state check (state in ('open', 'sending', 'ambiguous', 'recorded')),
  constraint stripe_transfer_claims_transfer_id check (
    stripe_transfer_id is null or stripe_transfer_id ~ '^tr_[A-Za-z0-9]+$'
  ),
  constraint stripe_transfer_claims_key check (idempotency_key = ledger_id::text)
);

alter table public.stripe_transfer_claims enable row level security;

create policy stripe_transfer_claims_admin_read on public.stripe_transfer_claims
  for select to authenticated
  using (public.is_admin());

grant select on public.stripe_transfer_claims to authenticated;

drop function if exists public.begin_transfer_send(uuid);

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

  -- A lost response stays on the same idempotency key. Stripe keeps that key for 24 hours.
  -- After that window, an unresolved attempt is reported and is not sent again.
  update public.stripe_transfer_claims
  set state = 'sending', updated_at = now()
  where ledger_id = target_entry
    and stripe_transfer_id is null
    and (
      state = 'open'
      or (
        confirm_absent
        and updated_at > now() - interval '23 hours'
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
    and claim.updated_at <= now() - interval '23 hours' then
    return jsonb_build_object('action', 'reconcile', 'transfer_id', null, 'idempotency_key', target_entry::text);
  end if;
  return jsonb_build_object('action', 'lookup', 'transfer_id', null, 'idempotency_key', target_entry::text);
end;
$function$;

create or replace function public.record_claimed_transfer(target_entry uuid, transfer_id text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  owner uuid;
begin
  if transfer_id is null or transfer_id !~ '^tr_[A-Za-z0-9]+$' then
    raise exception 'transfer id is missing';
  end if;
  select ledger_id into owner
  from public.stripe_transfer_claims
  where stripe_transfer_id = transfer_id
    and ledger_id <> target_entry;
  if owner is not null then
    raise exception 'that transfer belongs to another ledger row';
  end if;
  select id into owner
  from public.ledger_entries
  where stripe_transfer_id = transfer_id
    and id <> target_entry;
  if owner is not null then
    raise exception 'that transfer belongs to another ledger row';
  end if;

  insert into public.stripe_transfer_claims (ledger_id, idempotency_key, stripe_transfer_id, state)
  values (target_entry, target_entry::text, transfer_id, 'recorded')
  on conflict (ledger_id) do update
    set stripe_transfer_id = transfer_id,
        state = 'recorded',
        updated_at = now()
    where stripe_transfer_claims.stripe_transfer_id is null
      or stripe_transfer_claims.stripe_transfer_id = transfer_id;

  perform public.mark_transferred(target_entry, transfer_id);
  insert into public.job_events (job_id, actor_id, type, data)
  select job_id, null, 'stripe_transfer', jsonb_build_object('transfer_id', transfer_id)
  from public.ledger_entries
  where id = target_entry
    and not exists (
      select 1 from public.job_events
      where job_id = ledger_entries.job_id
        and type = 'stripe_transfer'
        and data->>'transfer_id' = transfer_id
    );
end;
$function$;

create or replace function public.note_transfer_unknown(target_entry uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.stripe_transfer_claims
  set state = 'ambiguous', updated_at = now()
  where ledger_id = target_entry
    and stripe_transfer_id is null
    and state = 'sending';
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
    and stripe_transfer_claims.updated_at <= now() - interval '23 hours';
end;
$$;

revoke all on function public.begin_transfer_send(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.record_claimed_transfer(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.note_transfer_unknown(uuid) from public, anon, authenticated, service_role;
grant execute on function public.begin_transfer_send(uuid, boolean) to service_role;
grant execute on function public.record_claimed_transfer(uuid, text) to service_role;
grant execute on function public.note_transfer_unknown(uuid) to service_role;
