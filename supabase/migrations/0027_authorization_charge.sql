-- apply_authorization assigned charge_id = charge_id. Postgres treats that name as both
-- the function argument and the column, so the update fails and the card stays unauthorized.

create or replace function public.apply_authorization(
  target_job uuid,
  payment_intent text,
  charge_id text,
  capture_before timestamptz,
  checkout_driver uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  stored_intent text;
begin
  if payment_intent is null or payment_intent !~ '^pi_[A-Za-z0-9]+$' then
    raise exception 'payment intent is missing';
  end if;
  if charge_id is not null and charge_id !~ '^ch_[A-Za-z0-9]+$' then
    raise exception 'charge id is not valid';
  end if;

  select * into job_row from public.jobs where id = target_job for update;
  if not found then
    return 'missing';
  end if;

  select job_payments.payment_intent_id into stored_intent
  from public.job_payments where job_id = target_job;

  if job_row.payment_status in ('authorized', 'paid', 'captured') then
    if stored_intent is not distinct from payment_intent then
      return 'accepted';
    end if;
    return 'duplicate';
  end if;

  if job_row.payment_due_at is not null and job_row.payment_due_at < now()
    and (
      job_row.status is distinct from 'assigned'
      or job_row.assigned_driver_id is distinct from checkout_driver
    ) then
    insert into public.payment_attempts (job_id, payment_intent_id, outcome)
    values (target_job, payment_intent, 'released_late');
    perform public.enqueue_notification(
      job_row.customer_id, target_job, 'payment_released',
      'Card hold released',
      'A card was approved after this job was reopened. The hold was released and you were not charged.',
      '/jobs/' || target_job::text,
      'payment-late:' || payment_intent
    );
    perform public.notify_admins(
      target_job, 'payment_released',
      'Late card authorization released',
      'A card was approved after the job was reopened or reassigned. The hold was released.',
      '/admin/requests/' || target_job::text,
      'payment-late-admin:' || payment_intent
    );
    return 'released_late';
  end if;

  if job_row.status is distinct from 'assigned'
    or job_row.assigned_driver_id is distinct from checkout_driver
    or job_row.payment_status not in ('awaiting_payment', 'failed') then
    insert into public.payment_attempts (job_id, payment_intent_id, outcome)
    values (target_job, payment_intent, 'released_late');
    perform public.enqueue_notification(
      job_row.customer_id, target_job, 'payment_released',
      'Card hold released',
      'This job is no longer waiting on that payment. The hold was released and you were not charged.',
      '/jobs/' || target_job::text,
      'payment-late:' || payment_intent
    );
    perform public.notify_admins(
      target_job, 'payment_released',
      'Card authorization released',
      'A card was approved for a job that is no longer assigned to that driver. The hold was released.',
      '/admin/requests/' || target_job::text,
      'payment-late-admin:' || payment_intent
    );
    return 'released_late';
  end if;

  perform set_config('pickuply.system_payment', 'yes', true);
  update public.jobs set payment_status = 'authorized' where id = target_job;
  update public.job_payments
  set payment_intent_id = payment_intent,
      charge_id = apply_authorization.charge_id,
      capture_before = apply_authorization.capture_before,
      updated_at = now()
  where job_id = target_job;

  insert into public.payment_attempts (job_id, payment_intent_id, outcome)
  values (target_job, payment_intent, 'authorized');
  insert into public.job_events (job_id, actor_id, type, data)
  values (
    target_job, null, 'payment_authorized',
    jsonb_build_object('payment_intent_id', payment_intent)
  );
  perform public.enqueue_notification(
    job_row.customer_id, target_job, 'payment_confirmed',
    'Payment confirmed',
    'Your card is authorized. The driver can start.',
    '/jobs/' || target_job::text,
    'payment-confirmed-customer:' || target_job::text
  );
  perform public.enqueue_notification(
    job_row.assigned_driver_id, target_job, 'payment_confirmed',
    'Payment confirmed: you can start',
    'The customer''s card is authorized. You can start this job.',
    '/driver/jobs/' || target_job::text,
    'payment-confirmed-driver:' || target_job::text
  );
  return 'accepted';
end;
$function$;

create or replace function public.note_checkout_expired(target_job uuid, session_id text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (select 1 from public.jobs where id = target_job) then
    return;
  end if;
  insert into public.payment_attempts (job_id, checkout_session_id, outcome)
  values (target_job, session_id, 'expired');
end;
$function$;
