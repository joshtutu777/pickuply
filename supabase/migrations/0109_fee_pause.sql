-- Turn the late-cancel fee and the trip fee off for new events.
-- The columns stay, so either fee can be turned back on without a new charge path.
-- Existing job rows that already stored a fee are not rewritten.
-- Do not apply this file to the hosted project until the owner approves it.

alter table public.platform_settings
  add column late_cancel_fee_cents integer not null default 0;

alter table public.platform_settings
  add constraint platform_settings_late_cancel_fee_nonnegative
  check (late_cancel_fee_cents >= 0);

alter table public.platform_settings
  alter column trip_fee_cents set default 0;

update public.platform_settings
set trip_fee_cents = 0,
    late_cancel_fee_cents = 0,
    updated_at = now()
where id = 1;

create or replace function public.begin_customer_cancel(target_job uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  payment_row public.job_payments%rowtype;
  driver_share integer := 0;
  fee integer := 0;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from uid then
    raise exception 'only the customer can cancel this job';
  end if;
  if job_row.status not in ('requested', 'in_review', 'quoted', 'open', 'assigned', 'en_route', 'arrived', 'item_check', 'in_transit') then
    raise exception 'this job can no longer be cancelled here';
  end if;
  select * into payment_row from public.job_payments where job_id = target_job;
  select coalesce(late_cancel_fee_cents, 0) into fee
  from public.platform_settings where id = 1;

  if fee > 0
    and job_row.assigned_driver_id is not null
    and job_row.payment_status = 'authorized'
    and job_row.status in ('assigned', 'en_route', 'arrived', 'item_check', 'in_transit') then
    if job_row.status <> 'assigned' then
      driver_share := least(1000, fee);
    end if;
    perform set_config('pickuply.system_payment', 'yes', true);
    update public.jobs
    set status = 'cancelled', late_cancel_cents = fee, fee_driver_cents = driver_share
    where id = target_job;
    insert into public.job_events (job_id, actor_id, type, data)
    values (target_job, uid, 'customer_cancel', jsonb_build_object('to', 'cancelled', 'fee', 'late_cancel', 'driver_cents', driver_share));
    return jsonb_build_object('outcome', 'late_cancel', 'payment_intent_id', payment_row.payment_intent_id, 'amount_cents', fee);
  end if;

  perform set_config('pickuply.system_payment', 'yes', true);
  update public.jobs
  set status = 'cancelled', payment_status = case when payment_status = 'authorized' then payment_status else 'none' end, payment_due_at = null
  where id = target_job;
  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, uid, 'customer_cancel', jsonb_build_object('to', 'cancelled', 'fee', 'none'));
  return jsonb_build_object(
    'outcome', case when job_row.payment_status = 'authorized' then 'release' else 'free' end,
    'payment_intent_id', payment_row.payment_intent_id,
    'checkout_session_id', payment_row.checkout_session_id
  );
end;
$function$;

create or replace function public.reject_pickup(target_job uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  fee integer := 0;
  driver_share integer := 0;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if length(btrim(coalesce(reason, ''))) < 3 then
    raise exception 'add a short reason';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from uid then
    raise exception 'only the customer can reject the item';
  end if;
  if job_row.status is distinct from 'item_check' then
    raise exception 'the item is not ready for a decision';
  end if;
  select coalesce(trip_fee_cents, 0) into fee from public.platform_settings where id = 1;
  if fee > 0 then
    driver_share := least(2000, fee);
  end if;

  update public.jobs
  set status = 'cancelled',
      trip_fee_cents = case when fee > 0 then fee else null end,
      fee_driver_cents = case when fee > 0 then driver_share else fee_driver_cents end,
      rejection_reason = left(btrim(reason), 500)
  where id = target_job;
  insert into public.job_events (job_id, actor_id, type, data)
  values (
    target_job, uid, 'pickup_rejected',
    jsonb_build_object('to', 'cancelled', 'trip_fee_cents', fee)
  );
  perform public.enqueue_notification(
    job_row.assigned_driver_id, target_job, 'pickup_rejected',
    'Item rejected',
    case
      when fee > 0 then 'The customer rejected the item at pickup. The trip fee is recorded.'
      else 'The customer rejected the item at pickup. No trip fee was charged.'
    end,
    '/driver/jobs/' || target_job::text,
    'pickup-rejected:' || target_job::text
  );
  perform public.notify_admins(
    target_job, 'pickup_rejected',
    'Item rejected at pickup',
    case
      when fee > 0 then 'The trip fee is recorded and still needs to be captured.'
      else 'The item was rejected. No trip fee is due.'
    end,
    '/admin/requests/' || target_job::text,
    'pickup-rejected-admin:' || target_job::text
  );
end;
$$;

create or replace function public.confirm_customer_no_show(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
  fee integer := 0;
  driver_share integer := 0;
begin
  if not public.is_admin() then
    raise exception 'only an admin can confirm a no-show fee';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or not job_row.no_show_pending then
    raise exception 'there is no no-show waiting';
  end if;
  select coalesce(trip_fee_cents, 0) into fee from public.platform_settings where id = 1;
  perform set_config('pickuply.system_payment', 'yes', true);
  if fee > 0 then
    driver_share := least(2000, fee);
    update public.jobs
    set status = 'cancelled', trip_fee_cents = fee, fee_driver_cents = driver_share, no_show_pending = false
    where id = target_job;
  else
    update public.jobs
    set status = 'cancelled', no_show_pending = false
    where id = target_job;
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'confirm_customer_no_show',
    'job',
    target_job,
    jsonb_build_object('trip_fee_cents', fee, 'driver_cents', driver_share)
  );
end;
$$;

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
  if coalesce(job_row.late_cancel_cents, 0) > 0 then
    amount := coalesce(job_row.fee_driver_cents, 0);
  elsif job_row.status = 'cancelled' and coalesce(job_row.trip_fee_cents, 0) > 0 then
    amount := coalesce(job_row.fee_driver_cents, least(2000, job_row.trip_fee_cents));
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

  insert into public.ledger_entries (
    job_id, driver_id, amount_cents, status, hold_reason, available_on, entry_kind
  ) values (
    target_job, job_row.assigned_driver_id, amount, next_status, reason, available_on, 'base'
  )
  on conflict (job_id) where entry_kind = 'base' do update
    set amount_cents = excluded.amount_cents,
        updated_at = now()
    where public.ledger_entries.amount_cents is distinct from excluded.amount_cents
      and public.ledger_entries.entry_kind = 'base';
end;
$function$;
