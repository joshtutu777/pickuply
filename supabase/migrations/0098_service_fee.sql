-- Marketplace service fee: a percent of the accepted offer, added on top.
-- Default 500 basis points (5%), rounded half up. Commission stays 15% of the
-- offer and driver earnings stay 85%. This file does not rewrite stored prices,
-- earnings, commission, service-fee cents, or refunds.
-- Stripe's own processing cost stays in job_payments.stripe_fee_cents.
-- Number 0098 is unused on main. 0099 through 0101 belong to other branches.

alter table public.platform_settings
  add column service_fee_bps integer not null default 500
  check (service_fee_bps >= 0 and service_fee_bps < 10000);

alter table public.job_offers
  add column service_fee_bps integer,
  add constraint job_offers_service_fee_bps check (
    service_fee_bps is null or (service_fee_bps >= 0 and service_fee_bps < 10000)
  );

alter table public.jobs
  add column service_fee_bps integer,
  add constraint jobs_service_fee_bps check (
    service_fee_bps is null or (service_fee_bps >= 0 and service_fee_bps < 10000)
  );

create or replace function public.price_breakdown(mode text, amount_cents integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  settings public.platform_settings%rowtype;
  earnings integer;
  platform integer;
  fee integer;
  total integer;
begin
  if mode not in ('forward', 'accept') then
    raise exception 'unknown price mode';
  end if;
  if amount_cents is null or amount_cents <= 0 then
    raise exception 'offer amount must be a positive number of cents';
  end if;
  select * into settings from public.platform_settings where id = 1;
  earnings := public.round_half_up(amount_cents::bigint * (10000 - settings.platform_bps), 10000);
  if earnings <= 0 then
    raise exception 'driver earnings would be zero';
  end if;
  platform := amount_cents - earnings;
  fee := public.round_half_up(amount_cents::bigint * settings.service_fee_bps, 10000);
  total := amount_cents + fee;
  return jsonb_build_object(
    'driver_earnings_cents', earnings,
    'platform_fee_cents', platform,
    'subtotal_cents', amount_cents,
    'service_fee_cents', fee,
    'customer_total_cents', total,
    'commission_bps', settings.platform_bps,
    'service_fee_bps', settings.service_fee_bps,
    'offer_cents', amount_cents
  );
end;
$$;

create or replace function public.snapshot_offer_service_fee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rate integer;
  offer_amount integer;
  expected integer;
begin
  if new.service_fee_bps is not null then
    return new;
  end if;
  select service_fee_bps into rate from public.platform_settings where id = 1;
  offer_amount := coalesce(new.driver_amount_cents, 0) + coalesce(new.platform_fee_cents, 0);
  expected := public.round_half_up(offer_amount::bigint * rate, 10000);
  if new.service_fee_cents is not distinct from expected then
    new.service_fee_bps := rate;
  end if;
  return new;
end;
$$;

drop trigger if exists job_offers_service_fee_bps on public.job_offers;
create trigger job_offers_service_fee_bps
  before insert or update of service_fee_cents, driver_amount_cents, platform_fee_cents
  on public.job_offers
  for each row execute function public.snapshot_offer_service_fee();

create or replace function public.snapshot_job_service_fee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.service_fee_bps is not null or new.service_fee_cents is null then
    return new;
  end if;
  select offers.service_fee_bps into new.service_fee_bps
  from public.job_offers offers
  where offers.job_id = new.id
    and offers.service_fee_cents is not distinct from new.service_fee_cents
    and offers.service_fee_bps is not null
  order by offers.created_at desc
  limit 1;
  return new;
end;
$$;

drop trigger if exists jobs_service_fee_bps on public.jobs;
create trigger jobs_service_fee_bps
  before insert or update of service_fee_cents on public.jobs
  for each row execute function public.snapshot_job_service_fee();

create or replace function public.update_platform_settings(
  platform_bps integer,
  platform_min_cents integer,
  service_bps integer,
  service_fixed_cents integer,
  payment_due_minutes integer
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.is_admin() then
    raise exception 'only an admin can change settings';
  end if;
  if service_bps is null or service_bps < 0 or service_bps >= 10000 then
    raise exception 'service fee rate is not valid';
  end if;
  if platform_bps is null or platform_bps < 0 or platform_bps >= 10000 then
    raise exception 'commission rate is not valid';
  end if;
  update public.platform_settings
  set
    platform_bps = update_platform_settings.platform_bps,
    platform_min_cents = update_platform_settings.platform_min_cents,
    service_fee_bps = update_platform_settings.service_bps,
    payment_due_minutes = update_platform_settings.payment_due_minutes,
    updated_at = now()
  where id = 1;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'update_platform_settings',
    'platform_settings',
    null,
    jsonb_build_object(
      'platform_bps', platform_bps,
      'platform_min_cents', platform_min_cents,
      'service_fee_bps', service_bps,
      'payment_due_minutes', payment_due_minutes
    )
  );
end;
$function$;

create or replace function public.refund_cap_cents(target_job uuid, include_service_fee boolean)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
  remaining integer;
  retained integer;
begin
  select * into job_row from public.jobs where id = target_job;
  if not found then
    return 0;
  end if;
  remaining := greatest(coalesce(job_row.captured_cents, 0) - coalesce(job_row.refunded_cents, 0), 0);
  if coalesce(job_row.late_cancel_cents, 0) > 0 or coalesce(job_row.trip_fee_cents, 0) > 0 then
    return remaining;
  end if;
  if include_service_fee then
    return remaining;
  end if;
  retained := least(greatest(coalesce(job_row.service_fee_cents, 0), 0), remaining);
  return remaining - retained;
end;
$$;

revoke all on function public.refund_cap_cents(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.refund_cap_cents(uuid, boolean) to service_role;

drop function if exists public.begin_refund(uuid, integer, text);

create or replace function public.begin_refund(
  target_job uuid,
  amount_cents integer,
  reason text,
  include_service_fee boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  payment_row public.job_payments%rowtype;
  refund_id uuid;
  moved boolean;
  cap integer;
begin
  if not public.is_admin() then
    raise exception 'only an admin can refund';
  end if;
  if amount_cents is null or amount_cents <= 0 or length(btrim(coalesce(reason, ''))) < 3 then
    raise exception 'enter an amount and a reason';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found then
    raise exception 'job not found';
  end if;
  select * into payment_row from public.job_payments where job_id = target_job;

  if job_row.payment_status = 'authorized' then
    if amount_cents is distinct from job_row.price_cents then
      raise exception 'a refund before capture releases the whole hold';
    end if;
    return jsonb_build_object('outcome', 'release', 'payment_intent_id', payment_row.payment_intent_id);
  end if;

  if job_row.payment_status is distinct from 'captured' or payment_row.charge_id is null then
    raise exception 'this payment cannot be refunded';
  end if;
  cap := public.refund_cap_cents(target_job, coalesce(include_service_fee, false));
  if amount_cents > cap then
    raise exception 'that refund is larger than the remaining charge';
  end if;

  insert into public.refund_requests (job_id, amount_cents, reason, status, created_by)
  values (target_job, amount_cents, left(btrim(reason), 500), 'pending', auth.uid())
  returning id into refund_id;
  select exists (
    select 1 from public.ledger_entries
    where job_id = target_job and status = 'transferred'
  ) into moved;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(), 'request_refund', 'job', target_job,
    jsonb_build_object(
      'refund_id', refund_id,
      'amount_cents', amount_cents,
      'include_service_fee', coalesce(include_service_fee, false)
    )
  );
  return jsonb_build_object(
    'outcome', 'refund',
    'refund_id', refund_id,
    'charge_id', payment_row.charge_id,
    'amount_cents', amount_cents,
    'transferred', moved
  );
end;
$function$;

revoke all on function public.begin_refund(uuid, integer, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.begin_refund(uuid, integer, text, boolean) to authenticated;
