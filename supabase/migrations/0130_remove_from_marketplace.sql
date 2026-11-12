-- An admin can take a posted request off the driver marketplace.
-- The job, its offers, and its history stay. Open offers are closed, not deleted.
-- A driver, a card hold, a charge, a refund, a dispute, or any other money record blocks it.
-- The job row is locked first, the same way a claim or a card authorization locks it.

create or replace function public.marketplace_removal_code(job_row public.jobs)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
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

  if coalesce(job_row.payment_status, 'none') not in ('none')
    or coalesce(job_row.captured_cents, 0) > 0
    or job_row.stripe_payment_intent_id is not null
    or coalesce(job_row.late_cancel_cents, 0) > 0
    or coalesce(job_row.trip_fee_cents, 0) > 0
    or coalesce(job_row.fee_driver_cents, 0) > 0
    or exists (select 1 from public.job_payments where job_id = job_row.id)
    or exists (select 1 from public.payment_attempts where job_id = job_row.id)
    or exists (select 1 from public.refund_requests where job_id = job_row.id)
    or exists (select 1 from public.ledger_entries where job_id = job_row.id)
    or exists (select 1 from public.recovery_obligations where job_id = job_row.id)
    or exists (select 1 from public.payouts where job_id = job_row.id) then
    return 'has_payment';
  end if;

  if job_row.status = 'cancelled' then
    return 'already_removed';
  end if;
  if job_row.status is distinct from 'open' then
    return 'not_posted';
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
  return public.marketplace_removal_code(job_row);
end;
$$;

create or replace function public.admin_remove_from_marketplace(target uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  job_row public.jobs%rowtype;
  outcome text;
begin
  if not public.is_admin() then
    raise exception 'only an admin can remove a request from the marketplace';
  end if;

  select * into job_row from public.jobs where id = target for update;
  if not found then
    raise exception 'request not found';
  end if;

  outcome := public.marketplace_removal_code(job_row);
  if outcome = 'ready' then
    update public.jobs
    set status = 'cancelled'
    where id = target
      and status = 'open'
      and assigned_driver_id is null
      and accepted_offer_id is null;
    if not found then
      select * into job_row from public.jobs where id = target;
      outcome := public.marketplace_removal_code(job_row);
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

revoke all on function public.marketplace_removal_code(public.jobs) from public, anon, authenticated, service_role;
revoke all on function public.marketplace_removal_reason(uuid) from public, anon, service_role;
revoke all on function public.admin_remove_from_marketplace(uuid) from public, anon, service_role;
grant execute on function public.marketplace_removal_reason(uuid) to authenticated;
grant execute on function public.admin_remove_from_marketplace(uuid) to authenticated;
