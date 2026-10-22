-- Customer checkout, authorization, and the unpaid-job deadline.
-- Do not apply this file to the hosted project until the owner approves.
-- Step 6e late-cancel reuses one partial capture on this same authorization.
-- It does not create a second charge and does not save a card.

create table public.job_payments (
  job_id uuid primary key references public.jobs (id) on delete cascade,
  checkout_session_id text,
  payment_intent_id text,
  charge_id text,
  capture_before timestamptz,
  checkout_attempt integer not null default 0,
  checkout_driver_id uuid,
  updated_at timestamptz not null default now(),
  constraint job_payments_attempt_nonnegative check (checkout_attempt >= 0),
  constraint job_payments_intent_id check (
    payment_intent_id is null or payment_intent_id ~ '^pi_[A-Za-z0-9]+$'
  ),
  constraint job_payments_charge_id check (
    charge_id is null or charge_id ~ '^ch_[A-Za-z0-9]+$'
  )
);

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  payment_intent_id text,
  checkout_session_id text,
  outcome text not null,
  created_at timestamptz not null default now(),
  constraint payment_attempts_outcome check (
    outcome in ('started', 'authorized', 'released_late', 'expired', 'failed', 'canceled')
  )
);

create index payment_attempts_job_idx on public.payment_attempts (job_id, created_at);

alter table public.job_payments enable row level security;
alter table public.payment_attempts enable row level security;

create policy job_payments_read on public.job_payments
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.jobs
      where jobs.id = job_payments.job_id and jobs.customer_id = auth.uid()
    )
  );

create policy payment_attempts_read on public.payment_attempts
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.jobs
      where jobs.id = payment_attempts.job_id and jobs.customer_id = auth.uid()
    )
  );

revoke all on public.job_payments from public, anon, authenticated;
revoke all on public.payment_attempts from public, anon, authenticated;
grant select on public.job_payments to authenticated;
grant select on public.payment_attempts to authenticated;

create or replace function public.guard_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prices_allowed boolean := coalesce(public.can_set_quote_prices(), false)
    or coalesce(current_setting('pickuply.offer_chosen', true), '') = 'yes'
    or coalesce(current_setting('pickuply.job_claimed', true), '') = 'yes';
  booking_step boolean := coalesce(current_setting('pickuply.job_claimed', true), '') = 'yes'
    or coalesce(current_setting('pickuply.offer_chosen', true), '') = 'yes';
  system_payment boolean := coalesce(current_setting('pickuply.system_payment', true), '') = 'yes';
  system_release boolean := coalesce(current_setting('pickuply.system_release', true), '') = 'yes';
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not public.is_admin() and not public.is_migration_session() then
      if new.customer_id is distinct from auth.uid() then
        raise exception 'customers can only create their own jobs';
      end if;
      if new.status is distinct from 'requested' then
        raise exception 'new jobs start as requested';
      end if;
    end if;
  else
    if new.pricing_method is distinct from old.pricing_method
      or new.offer_cents is distinct from old.offer_cents
      or new.budget_min_cents is distinct from old.budget_min_cents
      or new.budget_max_cents is distinct from old.budget_max_cents then
      raise exception 'the customer pricing preference cannot be changed';
    end if;

    if old.pricing_method = 'quote'
      and old.status = 'quoted'
      and new.status = 'open'
      and current_setting('pickuply.quote_accepted', true) is distinct from 'yes' then
      raise exception 'a quote job is published only when the customer accepts it';
    end if;

    if new.status = 'assigned'
      and old.status is distinct from 'open'
      and old.status is distinct from 'assigned' then
      raise exception 'assignment only follows an open job';
    end if;

    if new.status in ('en_route', 'arrived', 'item_check', 'in_transit', 'delivered', 'completed')
      and new.status is distinct from old.status
      and coalesce(new.payment_status, '') not in ('authorized', 'paid', 'captured') then
      raise exception 'payment must be authorized before work starts';
    end if;

    if new.assigned_driver_id is distinct from old.assigned_driver_id
      and not (
        coalesce(public.is_migration_session(), false)
        or booking_step
        or system_release
        or (
          coalesce(public.is_admin(), false)
          and coalesce(current_setting('pickuply.admin_assign', true), '') = 'yes'
        )
      ) then
      raise exception 'only an admin can assign a driver';
    end if;

    if (
      new.payment_status is distinct from old.payment_status
      or new.payment_due_at is distinct from old.payment_due_at
    ) and not (
      coalesce(public.is_migration_session(), false)
      or coalesce(public.is_admin(), false)
      or booking_step
      or system_payment
    ) then
      raise exception 'only the booking step can set payment status';
    end if;

    if (
      new.payment_status is distinct from old.payment_status
      or new.payment_due_at is distinct from old.payment_due_at
    )
      and coalesce(public.is_admin(), false)
      and not coalesce(public.is_migration_session(), false)
      and not booking_step
      and not system_payment then
      insert into public.audit_log (actor_id, action, target_type, target_id, data)
      values (
        auth.uid(),
        'set_payment_status',
        'job',
        new.id,
        jsonb_build_object('payment_status', new.payment_status)
      );
    end if;
  end if;

  if tg_op = 'INSERT' then
    if (
      new.price_cents is not null
      or new.driver_pay_cents is not null
      or new.platform_fee_cents is not null
      or new.service_fee_cents is not null
      or new.dump_fee_cents is not null
      or new.quote_expires_at is not null
    ) and not prices_allowed then
      raise exception 'only an admin can set quote prices';
    end if;
  elsif (
    new.price_cents is distinct from old.price_cents
    or new.driver_pay_cents is distinct from old.driver_pay_cents
    or new.platform_fee_cents is distinct from old.platform_fee_cents
    or new.service_fee_cents is distinct from old.service_fee_cents
    or new.dump_fee_cents is distinct from old.dump_fee_cents
    or new.quote_expires_at is distinct from old.quote_expires_at
  ) and not prices_allowed then
    raise exception 'only an admin can change quote prices';
  end if;

  if tg_op = 'INSERT' and new.status = 'assigned' then
    raise exception 'assignment only follows an open job';
  end if;
  if tg_op = 'INSERT'
    and new.pricing_method = 'quote'
    and new.status = 'open'
    and current_setting('pickuply.quote_accepted', true) is distinct from 'yes' then
    raise exception 'a quote job is published only when the customer accepts it';
  end if;

  if new.status in ('requested', 'in_review', 'quoted', 'open') and new.assigned_driver_id is not null then
    raise exception 'assigned_driver_id is set only when a driver is assigned';
  end if;
  if new.status = 'assigned' and new.assigned_driver_id is null then
    raise exception 'an assigned job needs an assigned driver';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prepare_checkout(target_job uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  next_attempt integer;
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;

  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from auth.uid() then
    raise exception 'only the customer can pay for this job';
  end if;
  if job_row.status is distinct from 'assigned' then
    raise exception 'this job is not waiting for payment';
  end if;
  if job_row.payment_status not in ('awaiting_payment', 'failed') then
    raise exception 'payment is not due';
  end if;
  if job_row.payment_due_at is null or job_row.payment_due_at <= now() then
    raise exception 'the payment window has closed';
  end if;
  if job_row.price_cents is null
    or coalesce(job_row.driver_pay_cents, 0) + coalesce(job_row.platform_fee_cents, 0) + coalesce(job_row.service_fee_cents, 0)
      is distinct from job_row.price_cents then
    raise exception 'the price breakdown does not add up';
  end if;
  if exists (
    select 1 from public.job_disputes
    where job_id = target_job and capture_hold
  ) then
    raise exception 'payment is on hold';
  end if;

  insert into public.job_payments (job_id, checkout_attempt, checkout_driver_id)
  values (target_job, 1, job_row.assigned_driver_id)
  on conflict (job_id) do update
    set checkout_attempt = public.job_payments.checkout_attempt + 1,
        checkout_driver_id = excluded.checkout_driver_id,
        updated_at = now()
  returning checkout_attempt into next_attempt;

  return jsonb_build_object(
    'attempt', next_attempt,
    'amount_cents', job_row.price_cents,
    'driver_id', job_row.assigned_driver_id,
    'due_at', job_row.payment_due_at
  );
end;
$function$;

create or replace function public.record_checkout_session(
  target_job uuid,
  session_id text,
  attempt integer
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if session_id is null or session_id !~ '^cs_[A-Za-z0-9_]+$' then
    raise exception 'checkout session is missing';
  end if;
  update public.job_payments
  set checkout_session_id = session_id, updated_at = now()
  where job_id = target_job and checkout_attempt = attempt;
  if not found then
    raise exception 'checkout attempt does not match';
  end if;
  insert into public.payment_attempts (job_id, checkout_session_id, outcome)
  values (target_job, session_id, 'started');
end;
$function$;

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
      charge_id = charge_id,
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

create or replace function public.mark_checkout_failed(target_job uuid, payment_intent text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
begin
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.payment_status not in ('awaiting_payment', 'failed') then
    return;
  end if;
  perform set_config('pickuply.system_payment', 'yes', true);
  update public.jobs set payment_status = 'failed' where id = target_job;
  insert into public.payment_attempts (job_id, payment_intent_id, outcome)
  values (target_job, payment_intent, 'failed');
  perform public.enqueue_notification(
    job_row.customer_id, target_job, 'payment_failed',
    'Payment was not approved',
    'You can try another card before the payment deadline.',
    '/jobs/' || target_job::text,
    'payment-failed:' || target_job::text || ':' || coalesce(payment_intent, 'none')
  );
end;
$function$;

create or replace function public.note_checkout_expired(target_job uuid, session_id text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.payment_attempts (job_id, checkout_session_id, outcome)
  values (target_job, session_id, 'expired');
end;
$function$;

create or replace function public.note_authorization_canceled(target_job uuid, payment_intent text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  stored_intent text;
begin
  select * into job_row from public.jobs where id = target_job for update;
  if not found then
    return;
  end if;
  select job_payments.payment_intent_id into stored_intent
  from public.job_payments where job_id = target_job;
  insert into public.payment_attempts (job_id, payment_intent_id, outcome)
  values (target_job, payment_intent, 'canceled');
  if job_row.payment_status = 'authorized' and stored_intent is not distinct from payment_intent then
    perform set_config('pickuply.system_payment', 'yes', true);
    update public.jobs set payment_status = 'canceled' where id = target_job;
    perform public.notify_admins(
      target_job, 'authorization_ended',
      'Card authorization ended',
      'The card hold ended before capture. Do not start a new charge automatically.',
      '/admin/requests/' || target_job::text,
      'authorization-ended:' || payment_intent
    );
  end if;
end;
$function$;

create or replace function public.overdue_payment_jobs()
returns table (job_id uuid, payment_intent_id text)
language sql
security definer
set search_path = public
as $$
  select jobs.id, job_payments.payment_intent_id
  from public.jobs
  left join public.job_payments on job_payments.job_id = jobs.id
  where jobs.status = 'assigned'
    and jobs.payment_status in ('awaiting_payment', 'failed')
    and jobs.payment_due_at < now();
$$;

create or replace function public.release_overdue_job(target_job uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  former_driver uuid;
begin
  select * into job_row from public.jobs where id = target_job for update;
  if not found
    or job_row.status is distinct from 'assigned'
    or job_row.payment_status not in ('awaiting_payment', 'failed')
    or job_row.payment_due_at is null
    or job_row.payment_due_at >= now() then
    return false;
  end if;

  former_driver := job_row.assigned_driver_id;
  if job_row.pricing_method is distinct from 'quote' and job_row.accepted_offer_id is not null then
    update public.job_offers
    set status = 'expired'
    where id = job_row.accepted_offer_id and status = 'chosen';
  end if;

  perform set_config('pickuply.system_release', 'yes', true);
  perform set_config('pickuply.system_payment', 'yes', true);
  update public.jobs
  set status = 'open',
      assigned_driver_id = null,
      accepted_offer_id = null,
      payment_status = 'none',
      payment_due_at = null
  where id = target_job;

  insert into public.job_events (job_id, actor_id, type, data)
  values (
    target_job, null, 'payment_deadline',
    jsonb_build_object('released_driver_id', former_driver, 'pricing_method', job_row.pricing_method)
  );
  perform public.enqueue_notification(
    job_row.customer_id, target_job, 'payment_deadline',
    'Payment window closed',
    'The driver was released. You can choose another driver or wait for a new offer.',
    '/jobs/' || target_job::text,
    'payment-deadline-customer:' || target_job::text
  );
  perform public.enqueue_notification(
    former_driver, target_job, 'payment_deadline',
    'Job released',
    'The customer did not pay in time, so you are no longer assigned.',
    '/driver',
    'payment-deadline-driver:' || target_job::text
  );
  perform public.notify_admins(
    target_job, 'payment_deadline',
    'Unpaid job reopened',
    'The payment deadline passed. The driver was released and the job is open again.',
    '/admin/requests/' || target_job::text,
    'payment-deadline-admin:' || target_job::text
  );
  return true;
end;
$function$;

create or replace function public.flag_capture_windows()
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row record;
begin
  for job_row in
    select jobs.id, job_payments.capture_before
    from public.jobs
    join public.job_payments on job_payments.job_id = jobs.id
    where jobs.payment_status = 'authorized'
      and job_payments.capture_before is not null
      and job_payments.capture_before < now() + interval '1 day'
  loop
    perform public.notify_admins(
      job_row.id, 'capture_window',
      'Card authorization is ending',
      'This card hold ends within a day. Do not start a new charge automatically.',
      '/admin/requests/' || job_row.id::text,
      'capture-window:' || job_row.id::text || ':' || to_char(job_row.capture_before at time zone 'UTC', 'YYYYMMDDHH24')
    );
  end loop;
end;
$function$;

revoke all on function public.prepare_checkout(uuid) from public, anon, authenticated, service_role;
grant execute on function public.prepare_checkout(uuid) to authenticated;

revoke all on function public.record_checkout_session(uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.record_checkout_session(uuid, text, integer) to service_role;

revoke all on function public.apply_authorization(uuid, text, text, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.apply_authorization(uuid, text, text, timestamptz, uuid) to service_role;

revoke all on function public.mark_checkout_failed(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mark_checkout_failed(uuid, text) to service_role;

revoke all on function public.note_checkout_expired(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.note_checkout_expired(uuid, text) to service_role;

revoke all on function public.note_authorization_canceled(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.note_authorization_canceled(uuid, text) to service_role;

revoke all on function public.overdue_payment_jobs() from public, anon, authenticated, service_role;
grant execute on function public.overdue_payment_jobs() to service_role;

revoke all on function public.release_overdue_job(uuid) from public, anon, authenticated, service_role;
grant execute on function public.release_overdue_job(uuid) to service_role;

revoke all on function public.flag_capture_windows() from public, anon, authenticated, service_role;
grant execute on function public.flag_capture_windows() to service_role;
