-- An admin can remove an open request whose only money records are inactive.
-- Stripe is checked by the server before this function runs. This function does not
-- call Stripe and does not delete payment attempts, ledger rows, or audit rows.
-- The original admin_remove_from_marketplace(uuid) stays strict.

create or replace function public.marketplace_removal_eligibility(job_row public.jobs)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if job_row.status = 'cancelled' then
    return 'already_removed';
  end if;

  if exists (select 1 from public.job_disputes where job_id = job_row.id)
    or exists (select 1 from public.dispute_resolutions where job_id = job_row.id)
    or job_row.status = 'disputed' then
    return 'has_dispute';
  end if;

  if job_row.assigned_driver_id is not null
    or job_row.accepted_offer_id is not null
    or job_row.status in ('assigned', 'en_route', 'arrived', 'item_check', 'in_transit', 'delivered') then
    return 'has_driver';
  end if;

  if coalesce(job_row.payment_status, 'none') not in ('none', 'failed', 'canceled')
    or coalesce(job_row.captured_cents, 0) > 0
    or coalesce(job_row.late_cancel_cents, 0) > 0
    or coalesce(job_row.trip_fee_cents, 0) > 0
    or coalesce(job_row.fee_driver_cents, 0) > 0
    or exists (
      select 1 from public.refund_requests
      where job_id = job_row.id and status in ('pending', 'succeeded')
    )
    or exists (select 1 from public.ledger_entries where job_id = job_row.id)
    or exists (select 1 from public.recovery_obligations where job_id = job_row.id)
    or exists (select 1 from public.payouts where job_id = job_row.id) then
    return 'has_payment';
  end if;

  if job_row.status is distinct from 'open' then
    return 'not_posted';
  end if;

  if job_row.stripe_payment_intent_id is not null
    or exists (
      select 1 from public.job_payments
      where job_id = job_row.id
        and (
          checkout_session_id is not null
          or payment_intent_id is not null
          or charge_id is not null
        )
    )
    or exists (
      select 1 from public.payment_attempts
      where job_id = job_row.id
        and (checkout_session_id is not null or payment_intent_id is not null)
    ) then
    return 'needs_stripe';
  end if;

  return 'ready';
end;
$$;

create or replace function public.marketplace_removal_reason(target uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can remove a request from the marketplace';
  end if;
  select * into job_row from public.jobs where id = target;
  if not found then
    raise exception 'request not found';
  end if;
  return public.marketplace_removal_eligibility(job_row);
end;
$$;

create or replace function public.admin_remove_verified_marketplace(
  target uuid,
  actor uuid,
  observed_payment_status text,
  verified_sessions text[],
  verified_intents text[],
  verified_charges text[]
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
  outcome text;
  current_sessions text[] := array[]::text[];
  current_intents text[] := array[]::text[];
  current_charges text[] := array[]::text[];
begin
  if actor is null or not exists (
    select 1 from public.profiles
    where id = actor and role = 'admin' and not blocked
  ) then
    raise exception 'only an admin can remove a request from the marketplace';
  end if;

  select * into job_row from public.jobs where id = target for update;
  if not found then
    raise exception 'request not found';
  end if;

  outcome := public.marketplace_removal_eligibility(job_row);
  if outcome in ('ready', 'needs_stripe') then
    select coalesce(array_agg(distinct session_id), array[]::text[])
    into current_sessions
    from (
      select checkout_session_id as session_id from public.job_payments where job_id = target
      union all
      select checkout_session_id from public.payment_attempts where job_id = target
    ) found_ids
    where session_id is not null;

    select coalesce(array_agg(distinct intent_id), array[]::text[])
    into current_intents
    from (
      select payment_intent_id as intent_id from public.job_payments where job_id = target
      union all
      select payment_intent_id from public.payment_attempts where job_id = target
      union all
      select job_row.stripe_payment_intent_id
    ) found_ids
    where intent_id is not null;

    select coalesce(array_agg(distinct charge_id), array[]::text[])
    into current_charges
    from public.job_payments
    where job_id = target and charge_id is not null;

    if coalesce(job_row.payment_status, 'none')
        is distinct from coalesce(nullif(observed_payment_status, ''), 'none')
      or exists (
        select 1 from unnest(current_sessions) as id
        where id is not null and not (id = any(coalesce(verified_sessions, array[]::text[])))
      )
      or exists (
        select 1 from unnest(current_intents) as id
        where id is not null and not (id = any(coalesce(verified_intents, array[]::text[])))
      )
      or exists (
        select 1 from unnest(current_charges) as id
        where id is not null and not (id = any(coalesce(verified_charges, array[]::text[])))
      ) then
      outcome := 'payment_changed';
    end if;
  end if;

  if outcome in ('ready', 'needs_stripe') then
    update public.jobs
    set status = 'cancelled'
    where id = target
      and status = 'open'
      and assigned_driver_id is null
      and accepted_offer_id is null
      and coalesce(payment_status, 'none') in ('none', 'failed', 'canceled')
      and coalesce(payment_status, 'none') = coalesce(nullif(observed_payment_status, ''), 'none');
    if not found then
      select * into job_row from public.jobs where id = target;
      outcome := public.marketplace_removal_eligibility(job_row);
      if outcome in ('ready', 'needs_stripe') then
        outcome := 'payment_changed';
      end if;
    else
      update public.job_offers
      set status = 'declined'
      where job_id = target
        and status = 'active';
      outcome := 'removed';
      insert into public.job_events (job_id, actor_id, type, data)
      values (
        target,
        actor,
        'removed_from_marketplace',
        jsonb_build_object('from', 'open', 'to', 'cancelled')
      );
    end if;
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    actor,
    'admin_remove_from_marketplace',
    'job',
    target,
    jsonb_build_object('outcome', outcome)
  );
  return outcome;
end;
$$;

revoke all on function public.marketplace_removal_eligibility(public.jobs) from public, anon, authenticated, service_role;
revoke all on function public.marketplace_removal_reason(uuid) from public, anon, service_role;
grant execute on function public.marketplace_removal_reason(uuid) to authenticated;
revoke all on function public.admin_remove_verified_marketplace(uuid, uuid, text, text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.admin_remove_verified_marketplace(uuid, uuid, text, text[], text[], text[]) to service_role;
