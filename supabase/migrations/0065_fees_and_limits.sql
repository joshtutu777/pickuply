-- Pilot booking window, fee splits, reschedules, no-shows, and rate limits.
-- Local until applied. Does not charge a card by itself.

alter table public.jobs
  add column if not exists late_cancel_cents integer,
  add column if not exists fee_driver_cents integer,
  add column if not exists reschedule_used boolean not null default false,
  add column if not exists reschedule_date text,
  add column if not exists reschedule_window text,
  add column if not exists reschedule_deadline timestamptz,
  add column if not exists no_show_pending boolean not null default false,
  add column if not exists pending_driver_id uuid references public.profiles (id),
  add column if not exists pending_total_cents integer;

alter table public.drivers
  add column if not exists cancellation_count integer not null default 0;

create table if not exists public.rate_limit_events (
  id bigint generated always as identity primary key,
  scope text not null,
  actor_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_events_lookup
  on public.rate_limit_events (scope, actor_key, created_at);

alter table public.rate_limit_events enable row level security;

create or replace function public.booking_date_allowed(preferred text)
returns boolean
language plpgsql
stable
as $$
declare
  today date := (timezone('America/New_York', now()))::date;
begin
  if preferred is null or preferred in ('asap', 'today', '') then
    return true;
  end if;
  if preferred !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;
  return preferred::date >= today and preferred::date <= today + 6;
end;
$$;

create or replace function public.guard_booking_window()
returns trigger
language plpgsql
as $$
begin
  if public.is_migration_session() then
    return new;
  end if;
  if not public.booking_date_allowed(new.preferred_date) then
    raise exception 'Choose a date within the next 6 days.';
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_booking_window on public.jobs;
create trigger jobs_booking_window
  before insert or update of preferred_date on public.jobs
  for each row execute function public.guard_booking_window();

create or replace function public.consume_rate_limit(
  scope text,
  actor_key text,
  max_count integer,
  window_seconds integer,
  message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  seen integer;
begin
  perform pg_advisory_xact_lock(hashtext(scope || ':' || actor_key));
  select count(*) into seen
  from public.rate_limit_events
  where rate_limit_events.scope = consume_rate_limit.scope
    and rate_limit_events.actor_key = consume_rate_limit.actor_key
    and created_at > now() - make_interval(secs => window_seconds);
  if seen >= max_count then
    raise exception '%', message;
  end if;
  insert into public.rate_limit_events (scope, actor_key)
  values (scope, actor_key);
end;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer, text) to service_role;

create or replace function public.guard_request_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_migration_session() then
    return new;
  end if;
  perform public.consume_rate_limit(
    'request', new.customer_id::text, 10, 86400,
    'You have reached 10 requests today. Try again tomorrow.'
  );
  return new;
end;
$$;

drop trigger if exists jobs_request_rate on public.jobs;
create trigger jobs_request_rate
  before insert on public.jobs
  for each row execute function public.guard_request_rate();

create or replace function public.guard_offer_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_migration_session() then
    return new;
  end if;
  perform public.consume_rate_limit(
    'offer', new.driver_id::text, 30, 3600,
    'You have sent 30 offers this hour. Try again later.'
  );
  return new;
end;
$$;

drop trigger if exists offers_rate on public.job_offers;
create trigger offers_rate
  before insert on public.job_offers
  for each row execute function public.guard_offer_rate();

create or replace function public.guard_message_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_migration_session() then
    return new;
  end if;
  perform public.consume_rate_limit(
    'message-minute', new.sender_id::text, 10, 60,
    'You have sent 10 messages this minute. Wait a moment.'
  );
  perform public.consume_rate_limit(
    'message-hour', new.sender_id::text, 60, 3600,
    'You have sent 60 messages this hour. Try again later.'
  );
  return new;
end;
$$;

drop trigger if exists messages_rate on public.messages;
create trigger messages_rate
  before insert on public.messages
  for each row execute function public.guard_message_rate();

create or replace function public.guard_help_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_migration_session() then
    return new;
  end if;
  perform public.consume_rate_limit(
    'help', new.profile_id::text, 5, 86400,
    'You have sent 5 help requests today. Try again tomorrow.'
  );
  return new;
end;
$$;

drop trigger if exists help_rate on public.help_requests;
create trigger help_rate
  before insert on public.help_requests
  for each row execute function public.guard_help_rate();

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
  if job_row.status = 'cancelled' and coalesce(job_row.late_cancel_cents, 0) > 0 then
    kind := 'late_cancel';
    amount := job_row.late_cancel_cents;
  elsif job_row.status = 'cancelled' and coalesce(job_row.trip_fee_cents, 0) > 0 then
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
  if kind not in ('full', 'trip', 'late_cancel') or amount_cents is null or amount_cents <= 0 then
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
  if coalesce(job_row.late_cancel_cents, 0) > 0 then
    amount := coalesce(job_row.fee_driver_cents, 0);
  elsif job_row.status = 'cancelled' and coalesce(job_row.trip_fee_cents, 0) > 0 then
    amount := least(2000, job_row.trip_fee_cents);
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

  insert into public.ledger_entries (job_id, driver_id, amount_cents, status, hold_reason, available_on)
  values (target_job, job_row.assigned_driver_id, amount, next_status, reason, available_on)
  on conflict (job_id) do update
    set amount_cents = excluded.amount_cents,
        updated_at = now()
    where public.ledger_entries.amount_cents is distinct from excluded.amount_cents;
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
  driver_share integer := 0;
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

  if job_row.assigned_driver_id is not null
    and job_row.payment_status = 'authorized'
    and job_row.status in ('assigned', 'en_route', 'arrived', 'item_check', 'in_transit') then
    if job_row.status <> 'assigned' then
      driver_share := 1000;
    end if;
    perform set_config('pickuply.system_payment', 'yes', true);
    update public.jobs
    set status = 'cancelled', late_cancel_cents = 1500, fee_driver_cents = driver_share
    where id = target_job;
    insert into public.job_events (job_id, actor_id, type, data)
    values (target_job, uid, 'customer_cancel', jsonb_build_object('to', 'cancelled', 'fee', 'late_cancel', 'driver_cents', driver_share));
    return jsonb_build_object('outcome', 'late_cancel', 'payment_intent_id', payment_row.payment_intent_id, 'amount_cents', 1500);
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

create or replace function public.request_reschedule(target_job uuid, next_date text, next_window text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  uid := auth.uid();
  if not public.booking_date_allowed(next_date) then
    raise exception 'Choose a date within the next 6 days.';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from uid then
    raise exception 'only the customer can reschedule this job';
  end if;
  if job_row.status is distinct from 'assigned' or job_row.reschedule_used then
    raise exception 'this job can no longer be rescheduled for free';
  end if;
  update public.jobs
  set reschedule_date = next_date, reschedule_window = next_window, reschedule_deadline = now() + interval '2 hours'
  where id = target_job;
  perform public.enqueue_notification(
    job_row.assigned_driver_id, target_job, 'reschedule',
    'Reschedule request',
    'The customer asked to move this pickup. Accept or decline within 2 hours.',
    '/driver/jobs/' || target_job::text,
    'reschedule:' || target_job::text
  );
end;
$$;

revoke all on function public.request_reschedule(uuid, text, text) from public, anon, service_role;
grant execute on function public.request_reschedule(uuid, text, text) to authenticated;

create or replace function public.respond_reschedule(target_job uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.assigned_driver_id is distinct from uid then
    raise exception 'only the assigned driver can answer';
  end if;
  if job_row.reschedule_deadline is null then
    raise exception 'there is no reschedule waiting';
  end if;
  if job_row.reschedule_deadline < now() then
    accept := false;
  end if;
  if accept then
    update public.jobs
    set preferred_date = reschedule_date,
        time_window = coalesce(reschedule_window, time_window),
        reschedule_used = true,
        reschedule_date = null,
        reschedule_window = null,
        reschedule_deadline = null
    where id = target_job;
  else
    update public.jobs
    set status = 'open',
        assigned_driver_id = null,
        accepted_offer_id = null,
        reschedule_used = true,
        reschedule_date = null,
        reschedule_window = null,
        reschedule_deadline = null
    where id = target_job;
    insert into public.job_events (job_id, actor_id, type, data)
    values (target_job, uid, 'reschedule_declined', jsonb_build_object('to', 'open'));
  end if;
end;
$$;

revoke all on function public.respond_reschedule(uuid, boolean) from public, anon, service_role;
grant execute on function public.respond_reschedule(uuid, boolean) to authenticated;

create or replace function public.mark_customer_no_show(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  arrived_at timestamptz;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.assigned_driver_id is distinct from uid or job_row.status is distinct from 'arrived' then
    raise exception 'wait until you have arrived';
  end if;
  select min(created_at) into arrived_at
  from public.job_events
  where job_id = target_job and type = 'status' and data->>'to' = 'arrived';
  if coalesce(arrived_at, job_row.updated_at) > now() - interval '15 minutes' then
    raise exception 'wait 15 minutes after arriving';
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
    'The driver waited 15 minutes. Confirm before any fee.',
    '/admin/requests/' || target_job::text,
    'no-show:' || target_job::text
  );
end;
$$;

revoke all on function public.mark_customer_no_show(uuid) from public, anon, service_role;
grant execute on function public.mark_customer_no_show(uuid) to authenticated;

create or replace function public.confirm_customer_no_show(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can confirm a no-show fee';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or not job_row.no_show_pending then
    raise exception 'there is no no-show waiting';
  end if;
  perform set_config('pickuply.system_payment', 'yes', true);
  update public.jobs
  set status = 'cancelled', trip_fee_cents = 2500, fee_driver_cents = 2000, no_show_pending = false
  where id = target_job;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (auth.uid(), 'confirm_customer_no_show', 'job', target_job, jsonb_build_object('trip_fee_cents', 2500, 'driver_cents', 2000));
end;
$$;

revoke all on function public.confirm_customer_no_show(uuid) from public, anon, service_role;
grant execute on function public.confirm_customer_no_show(uuid) to authenticated;

create or replace function public.flag_driver_no_show(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
  window_start timestamptz;
  hour integer;
begin
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.status is distinct from 'assigned' then
    return;
  end if;
  hour := case job_row.time_window when 'afternoon' then 12 when 'evening' then 17 else 8 end;
  if job_row.preferred_date ~ '^\d{4}-\d{2}-\d{2}$' then
    window_start := (job_row.preferred_date::timestamp + make_interval(hours => hour)) at time zone 'America/New_York';
  else
    window_start := job_row.created_at;
  end if;
  if now() < window_start + interval '30 minutes' then
    return;
  end if;
  perform public.notify_admins(
    target_job, 'driver_no_show', 'Driver has not started',
    'The driver was not on the way 30 minutes after the window started.',
    '/admin/requests/' || target_job::text,
    'driver-no-show:' || target_job::text
  );
  perform public.enqueue_notification(
    job_row.customer_id, target_job, 'driver_no_show',
    'Your driver has not started',
    'You can ask for another driver or cancel with no fee.',
    '/jobs/' || target_job::text,
    'driver-no-show:' || target_job::text
  );
end;
$$;

revoke all on function public.flag_driver_no_show(uuid) from public, anon, authenticated;
grant execute on function public.flag_driver_no_show(uuid) to service_role;

create or replace function public.answer_driver_no_show(target_job uuid, choice text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if choice not in ('find', 'cancel') then
    raise exception 'choose another driver or a free cancel';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from uid or job_row.status is distinct from 'assigned' then
    raise exception 'this job is not waiting on the driver';
  end if;
  update public.drivers
  set cancellation_count = cancellation_count + 1
  where profile_id = job_row.assigned_driver_id;
  if choice = 'cancel' then
    perform set_config('pickuply.system_payment', 'yes', true);
    update public.jobs
    set status = 'cancelled', payment_due_at = null
    where id = target_job;
  else
    update public.jobs
    set status = 'open', assigned_driver_id = null, accepted_offer_id = null
    where id = target_job;
  end if;
  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, uid, 'driver_no_show', jsonb_build_object('choice', choice, 'fee', 'none'));
end;
$$;

revoke all on function public.answer_driver_no_show(uuid, text) from public, anon, service_role;
grant execute on function public.answer_driver_no_show(uuid, text) to authenticated;

create or replace function public.propose_reassignment(target_job uuid, next_driver uuid, next_total integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can reassign a job';
  end if;
  if next_total is null or next_total < 3500 then
    raise exception 'the total must be at least $35';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.status not in ('assigned', 'open') then
    raise exception 'this job cannot be reassigned now';
  end if;
  if next_total <= coalesce(job_row.price_cents, next_total) then
    update public.jobs
    set assigned_driver_id = next_driver, status = 'assigned', pending_driver_id = null, pending_total_cents = null
    where id = target_job;
  else
    update public.jobs
    set pending_driver_id = next_driver, pending_total_cents = next_total
    where id = target_job;
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (auth.uid(), 'propose_reassignment', 'job', target_job, jsonb_build_object('total_cents', next_total));
end;
$$;

revoke all on function public.propose_reassignment(uuid, uuid, integer) from public, anon, service_role;
grant execute on function public.propose_reassignment(uuid, uuid, integer) to authenticated;

create or replace function public.approve_reassignment(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from uid or job_row.pending_driver_id is null then
    raise exception 'there is no new total to approve';
  end if;
  perform set_config('pickuply.system_payment', 'yes', true);
  update public.jobs
  set assigned_driver_id = pending_driver_id,
      price_cents = pending_total_cents,
      status = 'assigned',
      payment_status = 'awaiting_payment',
      pending_driver_id = null,
      pending_total_cents = null
  where id = target_job;
end;
$$;

revoke all on function public.approve_reassignment(uuid) from public, anon, service_role;
grant execute on function public.approve_reassignment(uuid) to authenticated;

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
  if not found then
    return;
  end if;
  perform set_config('pickuply.system_payment', 'yes', true);
  update public.jobs
  set status = 'cancelled', payment_status = 'canceled'
  where id = target_job and coalesce(late_cancel_cents, 0) = 0;
end;
$function$;

create or replace function public.guard_damage_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
  delivered_at timestamptz;
begin
  if new.category is distinct from 'damaged' then
    return new;
  end if;
  select * into job_row from public.jobs where id = new.job_id;
  select min(created_at) into delivered_at
  from public.job_events
  where job_id = new.job_id and type = 'status' and data->>'to' = 'delivered';
  if job_row.status not in ('delivered', 'completed', 'disputed')
    or coalesce(delivered_at, job_row.updated_at) < now() - interval '48 hours' then
    raise exception 'Damage reports must be sent within 48 hours of delivery.';
  end if;
  return new;
end;
$$;

drop trigger if exists job_reports_damage_window on public.job_reports;
create trigger job_reports_damage_window
  before insert on public.job_reports
  for each row execute function public.guard_damage_window();
