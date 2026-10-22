-- Claims, offers, and payment status. Nothing is charged.
-- Do not apply this file to the hosted project until the owner approves.

alter table public.jobs add column payment_due_at timestamptz;

alter table public.jobs drop constraint jobs_payment_status;
alter table public.jobs add constraint jobs_payment_status check (
  payment_status is null or payment_status in (
    'none', 'authorized', 'captured', 'canceled',
    'awaiting_payment', 'paid', 'failed', 'refunded'
  )
);

alter table public.job_offers add column service_fee_cents integer not null default 0;

alter table public.job_offers drop constraint job_offers_amounts;
alter table public.job_offers add constraint job_offers_amounts check (
  driver_amount_cents > 0
  and platform_fee_cents >= 0
  and service_fee_cents >= 0
  and customer_total_cents = driver_amount_cents + platform_fee_cents + service_fee_cents
);

-- One active offer is enforced in guard_job_offers after the eligibility check.
-- A unique index would hide that error when a blocked driver repeats an offer.

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
  cap integer;
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
  if job_row.pricing_method = 'quote' then
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
    if job_row.pricing_method = 'fixed' then
      if new.kind = 'accept' and (new.customer_total_cents is distinct from job_row.offer_cents or new.outside_range) then
        raise exception 'accepting a fixed price must match the customer price';
      end if;
      if new.kind = 'counter' and (new.customer_total_cents = job_row.offer_cents or not new.outside_range) then
        raise exception 'a fixed-price counteroffer must differ and be flagged';
      end if;
      cap := job_row.offer_cents * 2;
    else
      if new.customer_total_cents between job_row.budget_min_cents and job_row.budget_max_cents then
        if new.outside_range or new.kind <> 'offer' then
          raise exception 'an in-range amount is an offer and is not flagged';
        end if;
      elsif not new.outside_range or new.kind <> 'counter' then
        raise exception 'an amount outside the range must be a flagged counteroffer';
      end if;
      cap := job_row.budget_max_cents * 2;
    end if;
    if new.kind = 'counter' and new.customer_total_cents > cap then
      raise exception 'a counteroffer cannot exceed twice the customer price';
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

create or replace function public.payment_due_at()
returns timestamptz
language sql
stable
security invoker
set search_path = public
as $$
  select now() + make_interval(mins => payment_due_minutes)
  from public.platform_settings
  where id = 1;
$$;

create or replace function public.claim_job(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  driver_row public.drivers%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into driver_row from public.drivers where profile_id = uid;
  if not found or not driver_row.is_online then
    raise exception 'go online before claiming a job';
  end if;
  if not public.driver_is_eligible_for_job(target_job) then
    raise exception 'this driver cannot claim this job';
  end if;

  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.status <> 'open' or job_row.pricing_method <> 'quote' then
    raise exception 'job already taken';
  end if;

  perform set_config('pickuply.job_claimed', 'yes', true);
  update public.jobs
  set
    status = 'assigned',
    assigned_driver_id = uid,
    payment_status = 'awaiting_payment',
    payment_due_at = public.payment_due_at()
  where id = target_job;

  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, uid, 'claimed', jsonb_build_object('to', 'assigned'));
end;
$function$;

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
  driver_row public.drivers%rowtype;
  breakdown jsonb;
  offer_kind public.offer_kind;
  outside boolean := false;
  offer_id uuid;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into driver_row from public.drivers where profile_id = uid;
  if not found or not driver_row.is_online then
    raise exception 'go online before sending an offer';
  end if;
  if not public.driver_is_eligible_for_job(target_job) then
    raise exception 'this driver cannot offer on this job';
  end if;
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
  if not found or job_row.status <> 'open' or job_row.pricing_method = 'quote' then
    raise exception 'offers are only allowed on open fixed or range jobs';
  end if;

  if job_row.pricing_method = 'fixed' and kind = 'accept' then
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
  if offer_kind = 'counter' and length(btrim(coalesce(reason, ''))) < 3 then
    raise exception 'a counteroffer needs a reason';
  end if;

  perform set_config('pickuply.offer_priced', 'yes', true);
  insert into public.job_offers (
    job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents,
    customer_total_cents, reason, outside_range, status, expires_at
  ) values (
    target_job,
    uid,
    offer_kind,
    (breakdown->>'driver_earnings_cents')::integer,
    (breakdown->>'platform_fee_cents')::integer,
    (breakdown->>'service_fee_cents')::integer,
    (breakdown->>'customer_total_cents')::integer,
    nullif(btrim(coalesce(reason, '')), ''),
    outside,
    'active',
    now() + interval '2 hours'
  )
  returning id into offer_id;
  return offer_id;
end;
$function$;

create or replace function public.withdraw_offer(target_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  update public.job_offers
  set status = 'withdrawn'
  where id = target_offer and driver_id = auth.uid() and status = 'active';
  if not found then
    raise exception 'that offer cannot be withdrawn';
  end if;
end;
$function$;

create or replace function public.choose_offer(target_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  offer_row public.job_offers%rowtype;
  job_row public.jobs%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into offer_row from public.job_offers where id = target_offer for update;
  if not found or offer_row.status <> 'active' or offer_row.expires_at <= now() then
    raise exception 'that offer is no longer available';
  end if;
  select * into job_row from public.jobs where id = offer_row.job_id for update;
  if not found or job_row.customer_id is distinct from uid or job_row.status <> 'open' then
    raise exception 'only the customer can choose an offer on an open job';
  end if;

  perform set_config('pickuply.offer_chosen', 'yes', true);
  update public.job_offers
  set status = 'chosen'
  where id = target_offer;
  update public.job_offers
  set status = 'declined'
  where job_id = offer_row.job_id and id <> target_offer and status = 'active';
  update public.jobs
  set
    status = 'assigned',
    assigned_driver_id = offer_row.driver_id,
    accepted_offer_id = target_offer,
    price_cents = offer_row.customer_total_cents,
    driver_pay_cents = offer_row.driver_amount_cents,
    platform_fee_cents = offer_row.platform_fee_cents,
    service_fee_cents = offer_row.service_fee_cents,
    payment_status = 'awaiting_payment',
    payment_due_at = public.payment_due_at()
  where id = offer_row.job_id;

  insert into public.job_events (job_id, actor_id, type, data)
  values (
    offer_row.job_id,
    uid,
    'offer_chosen',
    jsonb_build_object('offer_id', target_offer, 'to', 'assigned')
  );
end;
$function$;

create or replace function public.offer_summaries(target_job uuid)
returns table (
  offer_id uuid,
  driver_first_name text,
  vehicle_label text,
  jobs_completed integer,
  reason text,
  outside_range boolean,
  customer_total_cents integer,
  driver_earnings_cents integer,
  platform_fee_cents integer,
  service_fee_cents integer,
  status public.offer_status,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if not exists (
    select 1 from public.jobs
    where id = target_job and (customer_id = auth.uid() or public.is_admin())
  ) then
    return;
  end if;

  return query
  select
    offers.id,
    split_part(coalesce(profiles.full_name, 'Driver'), ' ', 1),
    trim(both ' ' from coalesce(vehicles.type::text, '') || ' ' || coalesce(vehicles.make, '')),
    drivers.new_driver_jobs_completed,
    offers.reason,
    offers.outside_range,
    offers.customer_total_cents,
    offers.driver_amount_cents,
    offers.platform_fee_cents,
    offers.service_fee_cents,
    offers.status,
    offers.expires_at
  from public.job_offers offers
  join public.profiles on profiles.id = offers.driver_id
  join public.drivers on drivers.profile_id = offers.driver_id
  left join lateral (
    select type, make
    from public.vehicles
    where driver_id = offers.driver_id
    order by approved desc, created_at desc
    limit 1
  ) vehicles on true
  where offers.job_id = target_job
    and offers.status = 'active'
    and offers.expires_at > now();
end;
$$;

revoke all on function public.claim_job(uuid) from public, anon, service_role;
revoke all on function public.submit_offer(uuid, text, integer, text) from public, anon, service_role;
revoke all on function public.withdraw_offer(uuid) from public, anon, service_role;
revoke all on function public.choose_offer(uuid) from public, anon, service_role;
revoke all on function public.offer_summaries(uuid) from public, anon, service_role;
grant execute on function public.claim_job(uuid) to authenticated;
grant execute on function public.submit_offer(uuid, text, integer, text) to authenticated;
grant execute on function public.withdraw_offer(uuid) to authenticated;
grant execute on function public.choose_offer(uuid) to authenticated;
grant execute on function public.offer_summaries(uuid) to authenticated;
