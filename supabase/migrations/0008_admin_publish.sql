-- Admin review, fee settings, and quote acceptance.
-- Integer-cent fees match lib/fees.ts. Do not apply this file to the hosted project yet.

create table public.platform_settings (
  id integer primary key check (id = 1),
  platform_bps integer not null default 1000 check (platform_bps >= 0 and platform_bps < 10000),
  platform_min_cents integer not null default 1000 check (platform_min_cents >= 0),
  service_bps integer not null default 290 check (service_bps >= 0 and service_bps < 10000),
  service_fixed_cents integer not null default 30 check (service_fixed_cents >= 0),
  payment_due_minutes integer not null default 30 check (payment_due_minutes between 5 and 1440),
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (id) values (1);

alter table public.platform_settings enable row level security;

create policy platform_settings_read on public.platform_settings
  for select to authenticated
  using (true);

grant select on public.platform_settings to authenticated;

alter table public.jobs
  add column service_fee_cents integer,
  add column admin_note text;

alter table public.jobs drop constraint jobs_money_nonnegative;
alter table public.jobs add constraint jobs_money_nonnegative check (
  (offer_cents is null or offer_cents >= 0)
  and (budget_min_cents is null or budget_min_cents >= 0)
  and (budget_max_cents is null or budget_max_cents >= 0)
  and (price_cents is null or price_cents >= 0)
  and (driver_pay_cents is null or driver_pay_cents >= 0)
  and (platform_fee_cents is null or platform_fee_cents >= 0)
  and (service_fee_cents is null or service_fee_cents >= 0)
  and (dump_fee_cents is null or dump_fee_cents >= 0)
  and (captured_cents is null or captured_cents >= 0)
);

create or replace function public.round_half_up(numerator bigint, denominator bigint)
returns integer
language sql
immutable
as $$
  select ((numerator + (denominator / 2)) / denominator)::integer;
$$;

create or replace function public.platform_fee_for(
  earnings_cents integer,
  platform_bps integer,
  platform_min integer
)
returns integer
language sql
immutable
as $$
  select greatest(
    public.round_half_up(earnings_cents::bigint * platform_bps, 10000),
    platform_min
  );
$$;

create or replace function public.service_charge_for(
  customer_total integer,
  service_bps integer,
  service_fixed integer
)
returns integer
language sql
immutable
as $$
  select public.round_half_up(customer_total::bigint * service_bps, 10000) + service_fixed;
$$;

create or replace function public.split_subtotal(
  subtotal integer,
  platform_bps integer,
  platform_min integer
)
returns table (driver_earnings_cents integer, platform_fee_cents integer)
language plpgsql
immutable
as $$
declare
  earnings integer;
  fee integer;
  gap integer;
  attempt integer;
begin
  if subtotal - platform_min > 0
    and public.platform_fee_for(subtotal - platform_min, platform_bps, platform_min) = platform_min then
    return query select subtotal - platform_min, platform_min;
    return;
  end if;

  earnings := public.round_half_up(subtotal::bigint * 10000, (10000 + platform_bps)::bigint);
  for attempt in 1..8 loop
    fee := public.platform_fee_for(earnings, platform_bps, platform_min);
    gap := subtotal - (earnings + fee);
    if gap = 0 and earnings > 0 then
      return query select earnings, fee;
      return;
    end if;
    earnings := earnings + gap;
  end loop;
  raise exception 'could not split the subtotal';
end;
$$;

create or replace function public.smallest_covered_total(
  subtotal integer,
  service_bps integer,
  service_fixed integer
)
returns integer
language plpgsql
immutable
as $$
declare
  total integer;
begin
  total := public.round_half_up(
    (subtotal + service_fixed)::bigint * 10000,
    (10000 - service_bps)::bigint
  );
  if total < subtotal then
    total := subtotal;
  end if;
  while total > subtotal
    and total - 1 - public.service_charge_for(total - 1, service_bps, service_fixed) >= subtotal loop
    total := total - 1;
  end loop;
  while total - public.service_charge_for(total, service_bps, service_fixed) < subtotal loop
    total := total + 1;
  end loop;
  return total;
end;
$$;

create or replace function public.price_breakdown(mode text, amount_cents integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  settings public.platform_settings%rowtype;
  platform integer;
  subtotal integer;
  service_fee integer;
  total integer;
  split record;
begin
  select * into settings from public.platform_settings where id = 1;
  if mode = 'forward' then
    if amount_cents is null or amount_cents <= 0 then
      raise exception 'driver earnings must be a positive number of cents';
    end if;
    platform := public.platform_fee_for(amount_cents, settings.platform_bps, settings.platform_min_cents);
    subtotal := amount_cents + platform;
    total := public.smallest_covered_total(subtotal, settings.service_bps, settings.service_fixed_cents);
    return jsonb_build_object(
      'driver_earnings_cents', amount_cents,
      'platform_fee_cents', platform,
      'subtotal_cents', subtotal,
      'service_fee_cents', total - subtotal,
      'customer_total_cents', total
    );
  elsif mode = 'accept' then
    if amount_cents is null or amount_cents <= 0 then
      raise exception 'customer total must be a positive number of cents';
    end if;
    service_fee := public.service_charge_for(amount_cents, settings.service_bps, settings.service_fixed_cents);
    subtotal := amount_cents - service_fee;
    if subtotal <= settings.platform_min_cents then
      raise exception 'driver earnings would be zero';
    end if;
    select * into split
    from public.split_subtotal(subtotal, settings.platform_bps, settings.platform_min_cents);
    if split.driver_earnings_cents + split.platform_fee_cents + service_fee is distinct from amount_cents then
      raise exception 'price parts do not add up';
    end if;
    return jsonb_build_object(
      'driver_earnings_cents', split.driver_earnings_cents,
      'platform_fee_cents', split.platform_fee_cents,
      'subtotal_cents', subtotal,
      'service_fee_cents', service_fee,
      'customer_total_cents', amount_cents
    );
  end if;
  raise exception 'unknown price mode';
end;
$$;

revoke all on function public.price_breakdown(text, integer) from public;
revoke all on function public.price_breakdown(text, integer) from anon;
revoke all on function public.price_breakdown(text, integer) from service_role;
grant execute on function public.price_breakdown(text, integer) to authenticated;

create or replace function public.guard_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
  end if;

  if tg_op = 'INSERT' then
    if (
      new.price_cents is not null
      or new.driver_pay_cents is not null
      or new.platform_fee_cents is not null
      or new.service_fee_cents is not null
      or new.dump_fee_cents is not null
      or new.quote_expires_at is not null
    ) and not public.can_set_quote_prices() then
      raise exception 'only an admin can set quote prices';
    end if;
  elsif (
    new.price_cents is distinct from old.price_cents
    or new.driver_pay_cents is distinct from old.driver_pay_cents
    or new.platform_fee_cents is distinct from old.platform_fee_cents
    or new.service_fee_cents is distinct from old.service_fee_cents
    or new.dump_fee_cents is distinct from old.dump_fee_cents
    or new.quote_expires_at is distinct from old.quote_expires_at
  ) and not public.can_set_quote_prices() then
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

create or replace function public.review_request(
  target_job uuid,
  action text,
  details jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  zone uuid;
  level public.service_level;
  vehicle public.vehicle_type;
  needs_ack boolean;
  breakdown jsonb;
  hours integer;
begin
  if not public.is_admin() then
    raise exception 'only an admin can review requests';
  end if;
  if action not in ('publish', 'quote', 'changes', 'decline') then
    raise exception 'choose a review action';
  end if;

  select * into job_row from public.jobs where id = target_job for update;
  if not found then
    raise exception 'request not found';
  end if;
  if job_row.status not in ('requested', 'in_review', 'quoted') then
    raise exception 'this request is no longer waiting for review';
  end if;

  if action = 'decline' then
    update public.jobs
    set status = 'cancelled', admin_note = nullif(btrim(coalesce(details->>'note', '')), '')
    where id = target_job;
  elsif action = 'changes' then
    if length(btrim(coalesce(details->>'note', ''))) < 3 then
      raise exception 'add a note the customer can read';
    end if;
    update public.jobs
    set status = 'in_review', admin_note = btrim(details->>'note')
    where id = target_job;
  else
    if job_row.status not in ('requested', 'in_review') then
      raise exception 'this request is no longer waiting for review';
    end if;
    zone := (details->>'zone_id')::uuid;
    if not exists (select 1 from public.zones where id = zone and active) then
      raise exception 'choose a zone';
    end if;
    if details->>'service_level' not in ('light', 'full') then
      raise exception 'choose a service level';
    end if;
    if details->>'required_vehicle' not in ('car', 'suv', 'pickup', 'van', 'box_truck', 'trailer') then
      raise exception 'choose the required vehicle';
    end if;
    level := (details->>'service_level')::public.service_level;
    vehicle := (details->>'required_vehicle')::public.vehicle_type;
    needs_ack := job_row.needs_value_approval
      or job_row.description ~* '(piano|gun safe|pool table|hot tub|\msafe\M)'
      or coalesce(job_row.junk_special_items::text, '') ~* '(piano|gun safe|pool table|hot tub|\msafe\M)';
    if needs_ack and coalesce((details->>'high_value_ok')::boolean, false) is not true then
      raise exception 'confirm the high-value or specialty item before publishing';
    end if;

    if action = 'publish' then
      if job_row.pricing_method not in ('fixed', 'range') then
        raise exception 'quote jobs are sent as a quote, not published directly';
      end if;
      update public.jobs
      set
        status = 'open',
        zone_id = zone,
        service_level = level,
        required_vehicle = vehicle,
        dump_fee_cents = greatest(coalesce((details->>'dump_fee_cents')::integer, 0), 0),
        admin_note = null
      where id = target_job;
    else
      if job_row.pricing_method <> 'quote' then
        raise exception 'only quote requests use an admin price';
      end if;
      if details->>'time_window' not in ('morning', 'afternoon', 'evening')
        or length(btrim(coalesce(details->>'preferred_date', ''))) < 4 then
        raise exception 'choose a pickup window';
      end if;
      breakdown := public.price_breakdown('forward', (details->>'driver_pay_cents')::integer);
      if (breakdown->>'customer_total_cents')::integer < 3500 then
        raise exception 'the customer total must be at least $35';
      end if;
      hours := coalesce((details->>'expires_hours')::integer, 24);
      if hours < 1 or hours > 168 then
        raise exception 'quote expiry must be between 1 and 168 hours';
      end if;
      update public.jobs
      set
        status = 'quoted',
        zone_id = zone,
        service_level = level,
        required_vehicle = vehicle,
        dump_fee_cents = greatest(coalesce((details->>'dump_fee_cents')::integer, 0), 0),
        driver_pay_cents = (breakdown->>'driver_earnings_cents')::integer,
        platform_fee_cents = (breakdown->>'platform_fee_cents')::integer,
        service_fee_cents = (breakdown->>'service_fee_cents')::integer,
        price_cents = (breakdown->>'customer_total_cents')::integer,
        preferred_date = btrim(details->>'preferred_date'),
        time_window = (details->>'time_window')::public.time_window,
        quote_expires_at = now() + make_interval(hours => hours),
        admin_note = null
      where id = target_job;
    end if;
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (auth.uid(), 'review_request', 'job', target_job, jsonb_build_object('action', action, 'details', details));
end;
$function$;

revoke all on function public.review_request(uuid, text, jsonb) from public;
revoke all on function public.review_request(uuid, text, jsonb) from anon;
revoke all on function public.review_request(uuid, text, jsonb) from service_role;
grant execute on function public.review_request(uuid, text, jsonb) to authenticated;

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
  update public.platform_settings
  set
    platform_bps = update_platform_settings.platform_bps,
    platform_min_cents = update_platform_settings.platform_min_cents,
    service_bps = update_platform_settings.service_bps,
    service_fixed_cents = update_platform_settings.service_fixed_cents,
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
      'service_bps', service_bps,
      'service_fixed_cents', service_fixed_cents,
      'payment_due_minutes', payment_due_minutes
    )
  );
end;
$function$;

revoke all on function public.update_platform_settings(integer, integer, integer, integer, integer) from public;
revoke all on function public.update_platform_settings(integer, integer, integer, integer, integer) from anon;
revoke all on function public.update_platform_settings(integer, integer, integer, integer, integer) from service_role;
grant execute on function public.update_platform_settings(integer, integer, integer, integer, integer) to authenticated;

create or replace function public.accept_admin_quote(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;

  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from auth.uid() then
    raise exception 'only the customer can accept this quote';
  end if;
  if job_row.pricing_method <> 'quote' or job_row.status <> 'quoted' then
    raise exception 'this job is not waiting for quote acceptance';
  end if;
  if job_row.price_cents is null or job_row.driver_pay_cents is null or job_row.service_fee_cents is null then
    raise exception 'the admin quote is incomplete';
  end if;
  if job_row.quote_expires_at is null or job_row.quote_expires_at <= now() then
    raise exception 'this quote has expired';
  end if;

  perform set_config('pickuply.quote_accepted', 'yes', true);
  update public.jobs
  set status = 'open', updated_at = now()
  where id = target_job;

  insert into public.job_events (job_id, actor_id, type, data)
  values (
    target_job,
    auth.uid(),
    'quote_accepted',
    jsonb_build_object('to', 'open')
  );
end;
$$;

create or replace function public.decline_admin_quote(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from auth.uid() then
    raise exception 'only the customer can decline this quote';
  end if;
  if job_row.status <> 'quoted' then
    raise exception 'this job is not waiting for quote acceptance';
  end if;
  update public.jobs set status = 'cancelled', updated_at = now() where id = target_job;
  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, auth.uid(), 'quote_declined', jsonb_build_object('to', 'cancelled'));
end;
$$;

revoke all on function public.decline_admin_quote(uuid) from public;
revoke all on function public.decline_admin_quote(uuid) from anon;
revoke all on function public.decline_admin_quote(uuid) from service_role;
grant execute on function public.decline_admin_quote(uuid) to authenticated;
