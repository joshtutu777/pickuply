-- Offer limits: five active offers per job, no 2x price cap, and admin-editable minimums.
-- Driver offer amounts are integer cents. The customer total is still calculated on the server.

alter table public.job_offers drop constraint job_offers_counter_reason;

alter table public.platform_settings
  add column delivery_offer_min_cents integer not null default 3500 check (delivery_offer_min_cents >= 0),
  add column junk_offer_min_cents integer not null default 5000 check (junk_offer_min_cents >= 0),
  add column store_offer_min_cents integer not null default 3500 check (store_offer_min_cents >= 0),
  add column free_item_offer_min_cents integer not null default 3500 check (free_item_offer_min_cents >= 0);

create or replace function public.offer_minimum_cents(service public.job_service)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case service
    when 'junk' then junk_offer_min_cents
    when 'construction' then store_offer_min_cents
    when 'free_item' then free_item_offer_min_cents
    else delivery_offer_min_cents
  end
  from public.platform_settings
  where id = 1;
$$;

revoke all on function public.offer_minimum_cents(public.job_service) from public, anon, service_role;
grant execute on function public.offer_minimum_cents(public.job_service) to authenticated;

create or replace function public.update_offer_minimums(
  delivery_cents integer,
  junk_cents integer,
  store_cents integer,
  free_item_cents integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can change settings';
  end if;
  if delivery_cents is null or delivery_cents < 0
    or junk_cents is null or junk_cents < 0
    or store_cents is null or store_cents < 0
    or free_item_cents is null or free_item_cents < 0 then
    raise exception 'minimum offer amounts must be zero or more';
  end if;
  update public.platform_settings
  set
    delivery_offer_min_cents = delivery_cents,
    junk_offer_min_cents = junk_cents,
    store_offer_min_cents = store_cents,
    free_item_offer_min_cents = free_item_cents,
    updated_at = now()
  where id = 1;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'update_offer_minimums',
    'platform_settings',
    null,
    jsonb_build_object(
      'delivery_cents', delivery_cents,
      'junk_cents', junk_cents,
      'store_cents', store_cents,
      'free_item_cents', free_item_cents
    )
  );
end;
$$;

revoke all on function public.update_offer_minimums(integer, integer, integer, integer) from public, anon, service_role;
grant execute on function public.update_offer_minimums(integer, integer, integer, integer) to authenticated;

create or replace function public.guard_active_offer_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_migration_session() then
    return new;
  end if;
  if new.status is distinct from 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;
  end if;
  perform 1 from public.jobs where id = new.job_id for update;
  if (
    select count(*)
    from public.job_offers
    where job_id = new.job_id
      and status = 'active'
      and expires_at > now()
      and id is distinct from new.id
  ) >= 5 then
    raise exception 'this job already has five active offers';
  end if;
  return new;
end;
$$;

drop trigger if exists job_offers_active_cap on public.job_offers;
create trigger job_offers_active_cap
  before insert or update of status on public.job_offers
  for each row execute function public.guard_active_offer_cap();

create or replace function public.guard_job_offers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
  driver_row public.drivers%rowtype;
  trusted boolean := coalesce(public.is_migration_session(), false)
    or coalesce(current_setting('pickuply.offer_chosen', true), '') = 'yes';
  priced boolean := coalesce(current_setting('pickuply.offer_priced', true), '') = 'yes';
  expected jsonb;
begin
  if new.status = 'chosen'
    and current_setting('pickuply.offer_chosen', true) is distinct from 'yes' then
    raise exception 'choosing an offer requires the customer booking step';
  end if;

  if tg_op = 'UPDATE'
    and new.driver_amount_cents is not distinct from old.driver_amount_cents
    and new.platform_fee_cents is not distinct from old.platform_fee_cents
    and new.service_fee_cents is not distinct from old.service_fee_cents
    and new.customer_total_cents is not distinct from old.customer_total_cents
    and new.kind is not distinct from old.kind
    and new.outside_range is not distinct from old.outside_range then
    return new;
  end if;

  select * into job_row from public.jobs where id = new.job_id;
  if not found then
    raise exception 'job not found';
  end if;
  if job_row.pricing_method = 'quote' and not priced then
    raise exception 'drivers cannot offer on a quote job';
  end if;

  if not trusted then
    if auth.uid() is null or new.driver_id is distinct from auth.uid() then
      raise exception 'only the signed-in driver can create this offer';
    end if;
    if job_row.status <> 'open' then
      raise exception 'offers are only allowed on open jobs';
    end if;
    select * into driver_row from public.drivers where profile_id = auth.uid();
    if not found or not driver_row.is_online then
      raise exception 'go online before sending an offer';
    end if;
    if not public.driver_is_eligible_for_job(new.job_id) then
      raise exception 'this driver cannot offer on this job';
    end if;
    if tg_op = 'INSERT' and exists (
      select 1 from public.job_offers
      where job_id = new.job_id and driver_id = new.driver_id and status = 'active'
    ) then
      raise exception 'withdraw your current offer before sending another';
    end if;
    if tg_op = 'INSERT' and new.status <> 'active' then
      raise exception 'a new offer starts as active';
    end if;
  end if;

  if not coalesce(public.is_migration_session(), false)
    and new.kind is distinct from 'accept'
    and coalesce(new.driver_amount_cents, 0) < coalesce(public.offer_minimum_cents(job_row.service), 0) then
    raise exception 'offer amount is below the minimum';
  end if;

  if priced then
    expected := public.price_breakdown(
      case when new.kind = 'accept' then 'accept' else 'forward' end,
      case when new.kind = 'accept' then job_row.offer_cents else new.driver_amount_cents end
    );
    if new.driver_amount_cents is distinct from (expected->>'driver_earnings_cents')::integer
      or new.platform_fee_cents is distinct from (expected->>'platform_fee_cents')::integer
      or new.service_fee_cents is distinct from (expected->>'service_fee_cents')::integer
      or new.customer_total_cents is distinct from (expected->>'customer_total_cents')::integer then
      raise exception 'offer amounts do not match the fee schedule';
    end if;
    if job_row.pricing_method = 'quote' then
      if new.kind is distinct from 'offer' or new.outside_range then
        raise exception 'a driver price on this job is an offer';
      end if;
      return new;
    end if;
    if job_row.pricing_method = 'fixed' then
      if new.kind = 'accept' and (new.customer_total_cents is distinct from job_row.offer_cents or new.outside_range) then
        raise exception 'accepting a fixed price must match the customer price';
      end if;
      if new.kind = 'counter' and (new.customer_total_cents = job_row.offer_cents or not new.outside_range) then
        raise exception 'a fixed-price counteroffer must differ and be flagged';
      end if;
    else
      if new.customer_total_cents between job_row.budget_min_cents and job_row.budget_max_cents then
        if new.outside_range or new.kind <> 'offer' then
          raise exception 'an in-range amount is an offer and is not flagged';
        end if;
      elsif not new.outside_range or new.kind <> 'counter' then
        raise exception 'an amount outside the range must be a flagged counteroffer';
      end if;
    end if;
    return new;
  end if;

  if job_row.pricing_method = 'fixed' then
    if new.kind = 'offer' then
      raise exception 'fixed jobs use accept or counter';
    end if;
    if new.kind = 'accept' and (new.driver_amount_cents is distinct from job_row.offer_cents or new.outside_range) then
      raise exception 'accepting a fixed price must match the customer price';
    end if;
    if new.kind = 'counter' and (new.driver_amount_cents = job_row.offer_cents or not new.outside_range) then
      raise exception 'a fixed-price counteroffer must differ and be flagged';
    end if;
  elsif job_row.pricing_method = 'range' then
    if new.kind = 'accept' then
      raise exception 'range jobs use offer or counter';
    end if;
    if new.driver_amount_cents between job_row.budget_min_cents and job_row.budget_max_cents then
      if new.outside_range or new.kind <> 'offer' then
        raise exception 'an in-range amount is an offer and is not flagged';
      end if;
    elsif not new.outside_range or new.kind <> 'counter' then
      raise exception 'an amount outside the range must be a flagged counteroffer';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.submit_offer(
  target_job uuid,
  kind text,
  earnings_cents integer,
  reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  breakdown jsonb;
  offer_kind public.offer_kind;
  outside boolean := false;
  offer_id uuid;
begin
  perform public.assert_driver_can_take_job(target_job, 'offer');
  update public.job_offers
  set status = 'expired'
  where job_id = target_job and driver_id = uid and status = 'active' and expires_at <= now();
  if exists (
    select 1 from public.job_offers
    where job_id = target_job and driver_id = uid and status = 'active'
  ) then
    raise exception 'withdraw your current offer before sending another';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.status <> 'open' then
    raise exception 'offers are only allowed on open jobs';
  end if;
  if not (job_row.pricing_method = 'fixed' and kind = 'accept')
    and (
      earnings_cents is null
      or earnings_cents < coalesce(public.offer_minimum_cents(job_row.service), 0)
    ) then
    raise exception 'offer amount is below the minimum';
  end if;
  if job_row.pricing_method = 'quote' then
    breakdown := public.price_breakdown('forward', earnings_cents);
    offer_kind := 'offer';
  elsif job_row.pricing_method = 'fixed' and kind = 'accept' then
    breakdown := public.price_breakdown('accept', job_row.offer_cents);
    offer_kind := 'accept';
  else
    breakdown := public.price_breakdown('forward', earnings_cents);
    if job_row.pricing_method = 'fixed' then
      if (breakdown->>'customer_total_cents')::integer = job_row.offer_cents then
        raise exception 'accept the posted price instead of countering with the same total';
      end if;
      offer_kind := 'counter';
      outside := true;
    elsif (breakdown->>'customer_total_cents')::integer
      between job_row.budget_min_cents and job_row.budget_max_cents then
      offer_kind := 'offer';
    else
      offer_kind := 'counter';
      outside := true;
    end if;
  end if;
  perform set_config('pickuply.offer_priced', 'yes', true);
  insert into public.job_offers (
    job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents,
    customer_total_cents, reason, outside_range, status, expires_at
  ) values (
    target_job, uid, offer_kind,
    (breakdown->>'driver_earnings_cents')::integer,
    (breakdown->>'platform_fee_cents')::integer,
    (breakdown->>'service_fee_cents')::integer,
    (breakdown->>'customer_total_cents')::integer,
    nullif(btrim(coalesce(reason, '')), ''),
    outside, 'active', now() + interval '2 hours'
  )
  returning id into offer_id;
  return offer_id;
end;
$function$;
