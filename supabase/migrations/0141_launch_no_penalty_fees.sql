-- Launch: do not capture cancellation, no-show, or rejected-item penalties.
-- Production already applied 0140_operational_sms_hours. This is the next version.
-- Already captured amounts and ledger rows are left as they are. No refund is created.
-- Fee settings, the 120-minute payment window, commissions, and offer functions stay as they are.

update public.platform_settings
set trip_fee_cents = 0,
    late_cancel_fee_cents = 0
where id = 1;

create or replace function public.capture_context(target_job uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  payment_row public.job_payments%rowtype;
  hours integer;
begin
  select * into job_row from public.jobs where id = target_job for update;
  if not found then
    return null;
  end if;
  if exists (select 1 from public.job_disputes where job_id = target_job and capture_hold) then
    return null;
  end if;
  if job_row.payment_status is distinct from 'authorized' or job_row.captured_cents is not null then
    return null;
  end if;
  if job_row.status is distinct from 'delivered' then
    return null;
  end if;
  select * into payment_row from public.job_payments where job_id = target_job;
  if payment_row.payment_intent_id is null then
    return null;
  end if;

  select auto_complete_hours into hours from public.platform_settings where id = 1;
  if job_row.customer_confirmed_at is null
    and coalesce(job_row.delivered_at, job_row.updated_at) >= now() - make_interval(hours => hours) then
    return null;
  end if;
  if job_row.price_cents is null or job_row.price_cents <= 0 then
    return null;
  end if;

  return jsonb_build_object(
    'payment_intent_id', payment_row.payment_intent_id,
    'charge_id', payment_row.charge_id,
    'amount_cents', job_row.price_cents,
    'kind', 'full',
    'capture_before', payment_row.capture_before,
    'service_fee_cents', job_row.service_fee_cents,
    'expired', payment_row.capture_before is not null and payment_row.capture_before <= now()
  );
end;
$function$;

create or replace function public.record_capture(
  target_job uuid,
  amount_cents integer,
  kind text,
  stripe_fee integer
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  payment_row public.job_payments%rowtype;
  shortfall boolean;
begin
  if kind is distinct from 'full' then
    raise exception 'penalty captures are off';
  end if;
  if amount_cents is null or amount_cents <= 0 then
    raise exception 'capture amount is missing';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found then
    return;
  end if;
  if exists (select 1 from public.job_disputes where job_id = target_job and capture_hold) then
    raise exception 'capture is on hold while this job is disputed';
  end if;
  if job_row.payment_status = 'captured' then
    return;
  end if;
  if job_row.payment_status is distinct from 'authorized' then
    raise exception 'the card is not authorized';
  end if;
  if job_row.status is distinct from 'delivered' then
    raise exception 'only a delivered booking can be captured';
  end if;
  if amount_cents is distinct from job_row.price_cents then
    raise exception 'capture must be the booking total';
  end if;
  select * into payment_row from public.job_payments where job_id = target_job;
  if payment_row.capture_before is not null and payment_row.capture_before <= now() then
    raise exception 'the card authorization expired';
  end if;

  shortfall := stripe_fee is not null and stripe_fee > coalesce(job_row.service_fee_cents, 0);
  perform set_config('pickuply.system_payment', 'yes', true);
  update public.jobs
  set payment_status = 'captured',
      captured_cents = amount_cents,
      status = 'completed'
  where id = target_job;
  update public.job_payments
  set stripe_fee_cents = coalesce(stripe_fee, stripe_fee_cents),
      fee_shortfall = shortfall,
      captured_at = now(),
      updated_at = now()
  where job_id = target_job;
  insert into public.job_events (job_id, actor_id, type, data)
  values (
    target_job, null, 'payment_captured',
    jsonb_build_object('amount_cents', amount_cents, 'kind', 'full', 'stripe_fee_cents', stripe_fee)
  );
end;
$function$;

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
  if job_row.status is distinct from 'completed' then
    return;
  end if;
  amount := job_row.driver_pay_cents;
  if amount is null or amount <= 0 then
    return;
  end if;

  select coalesce(payouts_enabled, false) and coalesce(transfers_active, false) into payouts_on
  from public.driver_connect_accounts
  where driver_id = job_row.assigned_driver_id
    and livemode = coalesce((select stripe_livemode from public.job_payments where job_id = target_job), false);

  if exists (select 1 from public.job_disputes where job_id = target_job and payout_hold) then
    next_status := 'held';
    reason := 'A problem report is open';
  elsif exists (select 1 from public.card_disputes where job_id = target_job and outcome is null) then
    next_status := 'held';
    reason := 'A card dispute is open';
  elsif not coalesce(payouts_on, false) then
    next_status := 'held_until_onboarding';
    reason := 'Needs payout setup';
  elsif public.driver_completed_jobs(job_row.assigned_driver_id) < 5 then
    next_status := 'pending';
    reason := 'Earnings stay held for 48 hours after a new driver finishes a job';
  else
    next_status := 'pending';
    reason := null;
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
  if job_row.payment_status = 'captured' or job_row.captured_cents is not null then
    raise exception 'this payment can no longer be cancelled here';
  end if;
  select * into payment_row from public.job_payments where job_id = target_job;

  perform set_config('pickuply.system_payment', 'yes', true);
  update public.jobs
  set status = 'cancelled',
      payment_status = case when payment_status = 'authorized' then payment_status else 'none' end,
      payment_due_at = null,
      late_cancel_cents = null,
      fee_driver_cents = null,
      trip_fee_cents = null
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
as $function$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
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
  if job_row.payment_status = 'captured' or job_row.captured_cents is not null then
    raise exception 'this payment can no longer be cancelled here';
  end if;

  perform set_config('pickuply.system_payment', 'yes', true);
  update public.jobs
  set status = 'cancelled',
      trip_fee_cents = null,
      late_cancel_cents = null,
      fee_driver_cents = null,
      rejection_reason = left(btrim(reason), 500)
  where id = target_job;
  insert into public.job_events (job_id, actor_id, type, data)
  values (
    target_job, uid, 'pickup_rejected',
    jsonb_build_object('to', 'cancelled', 'fee', 'none')
  );
  perform public.enqueue_notification(
    job_row.assigned_driver_id, target_job, 'pickup_rejected',
    'Item rejected',
    'The customer rejected the item. There is no penalty charge.',
    '/driver/jobs/' || target_job::text,
    'pickup-rejected:' || target_job::text
  );
  perform public.notify_admins(
    target_job, 'pickup_rejected',
    'Item rejected at pickup',
    'The booking was cancelled with no penalty. Release the card hold if it is still open.',
    '/admin/requests/' || target_job::text,
    'pickup-rejected-admin:' || target_job::text
  );
end;
$function$;

create or replace function public.mark_customer_no_show(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  arrived_at timestamptz;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.assigned_driver_id is distinct from uid then
    raise exception 'wait until you have arrived';
  end if;
  if job_row.no_show_pending then
    return;
  end if;

  if job_row.status = 'arrived' then
    select min(created_at) into arrived_at
    from public.job_events
    where job_id = target_job and type = 'status' and data->>'to' = 'arrived';
    if coalesce(arrived_at, job_row.updated_at) > now() - interval '15 minutes' then
      raise exception 'wait 15 minutes after arriving';
    end if;
  elsif job_row.status = 'in_transit' and job_row.dropoff_arrived_at is not null then
    if job_row.dropoff_arrived_at > now() - interval '15 minutes' then
      raise exception 'wait 15 minutes after arriving';
    end if;
  else
    raise exception 'wait until you have arrived';
  end if;

  if not exists (
    select 1 from public.job_photos
    where job_id = target_job and stage = 'no_show' and uploaded_by = uid
  ) then
    raise exception 'add a photo of the wait';
  end if;

  update public.jobs set no_show_pending = true where id = target_job;
  perform public.notify_admins(
    target_job, 'customer_no_show', 'Customer no-show',
    'The driver waited 15 minutes. There is no customer fee.',
    '/admin/requests/' || target_job::text,
    'no-show:' || target_job::text
  );
end;
$function$;

create or replace function public.confirm_customer_no_show(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can close a no-show';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or not job_row.no_show_pending then
    raise exception 'there is no no-show waiting';
  end if;
  if job_row.payment_status = 'captured' or job_row.captured_cents is not null then
    raise exception 'this payment can no longer be cancelled here';
  end if;
  perform set_config('pickuply.system_payment', 'yes', true);
  update public.jobs
  set status = 'cancelled',
      trip_fee_cents = null,
      late_cancel_cents = null,
      fee_driver_cents = null,
      no_show_pending = false
  where id = target_job;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (auth.uid(), 'confirm_customer_no_show', 'job', target_job, jsonb_build_object('fee', 'none'));
  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, auth.uid(), 'customer_no_show', jsonb_build_object('to', 'cancelled', 'fee', 'none'));
end;
$function$;

create or replace function public.finish_released_cancel(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.release_uncaptured_hold(target_job);
end;
$function$;

create or replace function public.jobs_to_release_authorization()
returns table (job_id uuid, payment_intent_id text)
language sql
security definer
set search_path = public
as $function$
  select jobs.id, job_payments.payment_intent_id
  from public.jobs
  left join public.job_payments on job_payments.job_id = jobs.id
  where jobs.captured_cents is null
    and jobs.payment_status = 'authorized'
    and (
      jobs.status = 'cancelled'
      or (jobs.status = 'open' and jobs.assigned_driver_id is null)
    );
$function$;

create or replace function public.release_uncaptured_hold(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
begin
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.captured_cents is not null or job_row.payment_status is distinct from 'authorized' then
    return;
  end if;
  if job_row.status is distinct from 'cancelled'
    and not (job_row.status = 'open' and job_row.assigned_driver_id is null) then
    return;
  end if;
  perform set_config('pickuply.system_payment', 'yes', true);
  update public.jobs
  set payment_status = 'canceled'
  where id = target_job;
  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, null, 'payment_released', jsonb_build_object('fee', 'none'));
end;
$function$;

create or replace function public.stored_payment_intent(target_job uuid)
returns text
language sql
stable
security definer
set search_path = public
as $function$
  select found.payment_intent
  from (
    select payments.payment_intent_id as payment_intent, 1 as source_rank, now() as seen_at
    from public.job_payments payments
    where payments.job_id = target_job
      and payments.payment_intent_id ~ '^pi_[A-Za-z0-9]+$'
    union all
    select jobs.stripe_payment_intent_id, 2, now()
    from public.jobs
    where jobs.id = target_job
      and jobs.stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'
    union all
    select attempts.payment_intent_id, 3, attempts.created_at
    from public.payment_attempts attempts
    where attempts.job_id = target_job
      and attempts.payment_intent_id ~ '^pi_[A-Za-z0-9]+$'
  ) found
  order by source_rank, seen_at desc
  limit 1;
$function$;

create or replace function public.flag_missing_payment_intent(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
begin
  select * into job_row from public.jobs where id = target_job;
  if not found or job_row.captured_cents is not null or job_row.payment_status is distinct from 'authorized' then
    return;
  end if;
  if job_row.status is distinct from 'cancelled'
    and not (job_row.status = 'open' and job_row.assigned_driver_id is null) then
    return;
  end if;
  if public.stored_payment_intent(target_job) is not null then
    return;
  end if;
  perform public.notify_admins(
    target_job,
    'missing_payment_intent',
    'Card hold needs review',
    'This booking is authorized, but no Stripe payment is stored. It was left unchanged.',
    '/admin/requests/' || target_job::text,
    'missing-payment-intent:' || target_job::text
  );
end;
$function$;

revoke all on function public.jobs_to_release_authorization() from public, anon, authenticated, service_role;
grant execute on function public.jobs_to_release_authorization() to service_role;

revoke all on function public.release_uncaptured_hold(uuid) from public, anon, authenticated, service_role;
grant execute on function public.release_uncaptured_hold(uuid) to service_role;

revoke all on function public.stored_payment_intent(uuid) from public, anon, authenticated, service_role;
grant execute on function public.stored_payment_intent(uuid) to service_role;

revoke all on function public.flag_missing_payment_intent(uuid) from public, anon, authenticated, service_role;
grant execute on function public.flag_missing_payment_intent(uuid) to service_role;
