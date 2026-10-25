-- Capture after delivery, the trip fee, and a free cancel before work starts.
-- A late cancel fee is a later partial capture on this same authorization.
-- Do not apply this file to the hosted project until the owner approves it.

alter table public.platform_settings
  add column auto_complete_hours integer not null default 24
  check (auto_complete_hours between 1 and 168);

alter table public.jobs
  add column refunded_cents integer not null default 0
  check (refunded_cents >= 0);

alter table public.job_payments
  add column stripe_fee_cents integer,
  add column fee_shortfall boolean not null default false,
  add column captured_at timestamptz,
  add constraint job_payments_stripe_fee_nonnegative check (
    stripe_fee_cents is null or stripe_fee_cents >= 0
  );

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
  amount integer;
  kind text;
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
  select * into payment_row from public.job_payments where job_id = target_job;
  if payment_row.payment_intent_id is null then
    return null;
  end if;

  select auto_complete_hours into hours from public.platform_settings where id = 1;
  if job_row.status = 'cancelled' and coalesce(job_row.trip_fee_cents, 0) > 0 then
    kind := 'trip';
    amount := least(job_row.trip_fee_cents, job_row.price_cents);
  elsif job_row.status = 'delivered'
    and (
      job_row.customer_confirmed_at is not null
      or job_row.updated_at < now() - make_interval(hours => hours)
    ) then
    kind := 'full';
    amount := job_row.price_cents;
  else
    return null;
  end if;
  if amount is null or amount <= 0 then
    return null;
  end if;

  return jsonb_build_object(
    'payment_intent_id', payment_row.payment_intent_id,
    'charge_id', payment_row.charge_id,
    'amount_cents', amount,
    'kind', kind,
    'capture_before', payment_row.capture_before,
    'service_fee_cents', job_row.service_fee_cents,
    'expired', payment_row.capture_before is not null and payment_row.capture_before <= now()
  );
end;
$function$;

create or replace function public.jobs_ready_for_capture()
returns table (job_id uuid)
language plpgsql
security definer
set search_path = public
as $function$
declare
  candidate uuid;
begin
  for candidate in
    select jobs.id
    from public.jobs
    where jobs.payment_status = 'authorized'
      and jobs.captured_cents is null
      and jobs.status in ('delivered', 'cancelled')
  loop
    if public.capture_context(candidate) is not null then
      job_id := candidate;
      return next;
    end if;
  end loop;
end;
$function$;

create or replace function public.note_capture_expired(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.notify_admins(
    target_job, 'capture_expired',
    'Card authorization expired',
    'The card hold ended before capture. Do not start a new charge automatically.',
    '/admin/requests/' || target_job::text,
    'capture-expired:' || target_job::text
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
  shortfall boolean;
begin
  if kind not in ('full', 'trip') or amount_cents is null or amount_cents <= 0 then
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

  shortfall := stripe_fee is not null and stripe_fee > coalesce(job_row.service_fee_cents, 0);
  perform set_config('pickuply.system_payment', 'yes', true);
  update public.jobs
  set payment_status = 'captured',
      captured_cents = amount_cents,
      status = case when kind = 'full' and status = 'delivered' then 'completed'::public.job_status else status end
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
    jsonb_build_object('amount_cents', amount_cents, 'kind', kind, 'stripe_fee_cents', stripe_fee)
  );
  perform public.enqueue_notification(
    job_row.customer_id, target_job, 'payment_captured',
    'Payment captured',
    'Your card was charged for this job.',
    '/jobs/' || target_job::text,
    'payment-captured:' || target_job::text
  );
  if shortfall then
    perform public.notify_admins(
      target_job, 'fee_shortfall',
      'Card fee was higher than the service fee',
      'The Stripe fee on this charge was higher than the service fee collected.',
      '/admin/requests/' || target_job::text,
      'fee-shortfall:' || target_job::text
    );
  end if;
end;
$function$;

create or replace function public.record_stripe_fee(target_job uuid, stripe_fee integer)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  service_fee integer;
  shortfall boolean;
begin
  if stripe_fee is null or stripe_fee < 0 then
    return;
  end if;
  select service_fee_cents into service_fee from public.jobs where id = target_job;
  shortfall := stripe_fee > coalesce(service_fee, 0);
  update public.job_payments
  set stripe_fee_cents = stripe_fee, fee_shortfall = shortfall, updated_at = now()
  where job_id = target_job and stripe_fee_cents is null;
  if shortfall then
    perform public.notify_admins(
      target_job, 'fee_shortfall',
      'Card fee was higher than the service fee',
      'The Stripe fee on this charge was higher than the service fee collected.',
      '/admin/requests/' || target_job::text,
      'fee-shortfall:' || target_job::text
    );
  end if;
end;
$function$;

create or replace function public.payments_missing_stripe_fee()
returns table (job_id uuid, charge_id text)
language sql
security definer
set search_path = public
as $$
  select job_payments.job_id, job_payments.charge_id
  from public.job_payments
  join public.jobs on jobs.id = job_payments.job_id
  where jobs.payment_status = 'captured'
    and job_payments.stripe_fee_cents is null
    and job_payments.charge_id is not null;
$$;

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
  if job_row.status is distinct from 'assigned' then
    raise exception 'this job can no longer be cancelled here';
  end if;

  select * into payment_row from public.job_payments where job_id = target_job;
  if job_row.payment_status in ('none', 'awaiting_payment', 'failed') then
    perform set_config('pickuply.system_payment', 'yes', true);
    update public.jobs
    set status = 'cancelled', payment_status = 'none', payment_due_at = null
    where id = target_job;
    insert into public.job_events (job_id, actor_id, type, data)
    values (target_job, uid, 'customer_cancel', jsonb_build_object('to', 'cancelled', 'fee', 'none'));
    perform public.enqueue_notification(
      job_row.assigned_driver_id, target_job, 'customer_cancel',
      'Job cancelled',
      'The customer cancelled before payment.',
      '/driver',
      'customer-cancel:' || target_job::text
    );
    return jsonb_build_object(
      'outcome', 'free',
      'payment_intent_id', payment_row.payment_intent_id,
      'checkout_session_id', payment_row.checkout_session_id
    );
  end if;

  if job_row.payment_status = 'authorized' then
    return jsonb_build_object(
      'outcome', 'release',
      'payment_intent_id', payment_row.payment_intent_id
    );
  end if;
  raise exception 'this payment can no longer be cancelled here';
end;
$function$;

create or replace function public.finish_released_cancel(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
begin
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.status is distinct from 'assigned' then
    return;
  end if;
  if job_row.payment_status not in ('authorized', 'canceled') then
    raise exception 'the card hold is still open';
  end if;
  perform set_config('pickuply.system_payment', 'yes', true);
  update public.jobs
  set status = 'cancelled', payment_status = 'canceled'
  where id = target_job;
  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, job_row.customer_id, 'customer_cancel', jsonb_build_object('to', 'cancelled', 'fee', 'none'));
  perform public.enqueue_notification(
    job_row.customer_id, target_job, 'customer_cancel',
    'Job cancelled',
    'The card hold was released. You were not charged.',
    '/jobs/' || target_job::text,
    'customer-cancel-released:' || target_job::text
  );
  perform public.enqueue_notification(
    job_row.assigned_driver_id, target_job, 'customer_cancel',
    'Job cancelled',
    'The customer cancelled before the job started. The card hold was released.',
    '/driver',
    'customer-cancel:' || target_job::text
  );
end;
$function$;

revoke all on function public.capture_context(uuid) from public, anon, authenticated, service_role;
grant execute on function public.capture_context(uuid) to service_role;

revoke all on function public.jobs_ready_for_capture() from public, anon, authenticated, service_role;
grant execute on function public.jobs_ready_for_capture() to service_role;

revoke all on function public.note_capture_expired(uuid) from public, anon, authenticated, service_role;
grant execute on function public.note_capture_expired(uuid) to service_role;

revoke all on function public.record_capture(uuid, integer, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.record_capture(uuid, integer, text, integer) to service_role;

revoke all on function public.record_stripe_fee(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.record_stripe_fee(uuid, integer) to service_role;

revoke all on function public.payments_missing_stripe_fee() from public, anon, authenticated, service_role;
grant execute on function public.payments_missing_stripe_fee() to service_role;

revoke all on function public.begin_customer_cancel(uuid) from public, anon, authenticated, service_role;
grant execute on function public.begin_customer_cancel(uuid) to authenticated;

revoke all on function public.finish_released_cancel(uuid) from public, anon, authenticated, service_role;
grant execute on function public.finish_released_cancel(uuid) to service_role;
