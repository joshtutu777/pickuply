-- Commission is a percent of the customer-facing offer, taken from the driver.
-- The customer pays that offer plus card processing. Existing job and offer
-- cents are left as stored. New rows record the commission rate used.

alter table public.platform_settings
  alter column platform_bps set default 1500,
  alter column platform_min_cents set default 0;

update public.platform_settings
set platform_bps = 1500, platform_min_cents = 0, updated_at = now()
where id = 1;

alter table public.job_offers
  add column commission_bps integer,
  add constraint job_offers_commission_bps check (commission_bps is null or (commission_bps >= 0 and commission_bps < 10000));

alter table public.jobs
  add column commission_bps integer,
  add constraint jobs_commission_bps check (commission_bps is null or (commission_bps >= 0 and commission_bps < 10000));

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
  total := public.smallest_covered_total(amount_cents, settings.service_bps, settings.service_fixed_cents);
  return jsonb_build_object(
    'driver_earnings_cents', earnings,
    'platform_fee_cents', platform,
    'subtotal_cents', amount_cents,
    'service_fee_cents', total - amount_cents,
    'customer_total_cents', total,
    'commission_bps', settings.platform_bps,
    'offer_cents', amount_cents
  );
end;
$$;

create or replace function public.guard_job_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed boolean := coalesce(public.can_set_quote_prices(), false)
    or coalesce(public.is_migration_session(), false)
    or coalesce(current_setting('pickuply.offer_chosen', true), '') = 'yes'
    or coalesce(current_setting('pickuply.job_claimed', true), '') = 'yes';
begin
  if tg_op = 'UPDATE'
    and old.commission_bps is null
    and old.platform_fee_cents is null
    and new.platform_fee_cents is not null
    and new.commission_bps is null
    and coalesce(public.can_set_quote_prices(), false)
    and coalesce(current_setting('pickuply.offer_chosen', true), '') is distinct from 'yes'
    and coalesce(current_setting('pickuply.job_claimed', true), '') is distinct from 'yes' then
    new.commission_bps := (select platform_bps from public.platform_settings where id = 1);
  end if;
  if new.commission_bps is distinct from (case when tg_op = 'UPDATE' then old.commission_bps else null end)
    and not allowed then
    raise exception 'only an admin can change quote prices';
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_commission_bps on public.jobs;
create trigger jobs_commission_bps
  before insert or update of commission_bps, platform_fee_cents on public.jobs
  for each row execute function public.guard_job_commission();

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
  offer_amount integer;
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
    and new.commission_bps is not distinct from old.commission_bps
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

  offer_amount := case
    when priced then new.driver_amount_cents + coalesce(new.platform_fee_cents, 0)
    else new.driver_amount_cents
  end;
  if not coalesce(public.is_migration_session(), false)
    and new.kind is distinct from 'accept'
    and coalesce(offer_amount, 0) < coalesce(public.offer_minimum_cents(job_row.service), 0) then
    raise exception 'offer amount is below the minimum';
  end if;

  if priced then
    expected := public.price_breakdown(
      case when new.kind = 'accept' then 'accept' else 'forward' end,
      case when new.kind = 'accept' then job_row.offer_cents else offer_amount end
    );
    if new.driver_amount_cents is distinct from (expected->>'driver_earnings_cents')::integer
      or new.platform_fee_cents is distinct from (expected->>'platform_fee_cents')::integer
      or new.service_fee_cents is distinct from (expected->>'service_fee_cents')::integer
      or new.customer_total_cents is distinct from (expected->>'customer_total_cents')::integer
      or new.commission_bps is distinct from (expected->>'commission_bps')::integer then
      raise exception 'offer amounts do not match the fee schedule';
    end if;
    if job_row.pricing_method = 'quote' then
      if new.kind is distinct from 'offer' or new.outside_range then
        raise exception 'a driver price on this job is an offer';
      end if;
      return new;
    end if;
    if job_row.pricing_method = 'fixed' then
      if new.kind = 'accept' and (
        new.driver_amount_cents + new.platform_fee_cents is distinct from job_row.offer_cents
        or new.outside_range
      ) then
        raise exception 'accepting a fixed price must match the customer price';
      end if;
      if new.kind = 'counter' and (
        new.driver_amount_cents + new.platform_fee_cents = job_row.offer_cents
        or not new.outside_range
      ) then
        raise exception 'a fixed-price counteroffer must differ and be flagged';
      end if;
    else
      if new.driver_amount_cents + new.platform_fee_cents between job_row.budget_min_cents and job_row.budget_max_cents then
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
  offer_amount integer;
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
    offer_amount := (breakdown->>'subtotal_cents')::integer;
    if job_row.pricing_method = 'fixed' then
      if offer_amount = job_row.offer_cents then
        raise exception 'accept the posted price instead of countering with the same total';
      end if;
      offer_kind := 'counter';
      outside := true;
    elsif offer_amount between job_row.budget_min_cents and job_row.budget_max_cents then
      offer_kind := 'offer';
    else
      offer_kind := 'counter';
      outside := true;
    end if;
  end if;
  perform set_config('pickuply.offer_priced', 'yes', true);
  insert into public.job_offers (
    job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents,
    customer_total_cents, commission_bps, reason, outside_range, status, expires_at
  ) values (
    target_job, uid, offer_kind,
    (breakdown->>'driver_earnings_cents')::integer,
    (breakdown->>'platform_fee_cents')::integer,
    (breakdown->>'service_fee_cents')::integer,
    (breakdown->>'customer_total_cents')::integer,
    (breakdown->>'commission_bps')::integer,
    nullif(btrim(coalesce(reason, '')), ''),
    outside, 'active', now() + interval '2 hours'
  )
  returning id into offer_id;
  return offer_id;
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
  if public.account_is_suspended(uid) then
    raise exception 'Your Pickuply account is restricted. You cannot create or book new pickups while this restriction is active.';
  end if;
  select * into offer_row from public.job_offers where id = target_offer;
  if not found or offer_row.status <> 'active' or offer_row.expires_at <= now() or offer_row.unavailable_at is not null then
    raise exception 'that offer is no longer available';
  end if;
  if public.account_is_suspended(offer_row.driver_id) then
    raise exception 'that offer is no longer available';
  end if;
  select * into job_row from public.jobs where id = offer_row.job_id for update;
  if not found or job_row.status <> 'open' then
    raise exception 'job already taken';
  end if;
  if job_row.customer_id is distinct from uid then
    raise exception 'only the customer can choose an offer on an open job';
  end if;
  select * into offer_row from public.job_offers where id = target_offer for update;
  if not found or offer_row.status <> 'active' or offer_row.expires_at <= now() or offer_row.unavailable_at is not null then
    raise exception 'that offer is no longer available';
  end if;
  perform set_config('pickuply.offer_chosen', 'yes', true);
  update public.job_offers set status = 'chosen' where id = target_offer;
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
    commission_bps = offer_row.commission_bps,
    payment_status = 'awaiting_payment',
    payment_due_at = public.payment_due_at()
  where id = offer_row.job_id;
  insert into public.job_events (job_id, actor_id, type, data)
  values (
    offer_row.job_id, uid, 'offer_chosen',
    jsonb_build_object('offer_id', target_offer, 'to', 'assigned')
  );
end;
$function$;

-- Driver alerts name the stored earnings. Titles stay the same so older checks still match.
create or replace function public.notify_on_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  area text := left(coalesce(new.pickup_area, 'your area'), 80);
  driver uuid;
  due text;
  held text;
  earn text := case
    when new.driver_pay_cents is null then null
    when new.driver_pay_cents % 100 = 0 then '$' || (new.driver_pay_cents / 100)::text
    else '$' || trim(to_char(new.driver_pay_cents / 100.0, 'FM999999990.00'))
  end;
begin
  if tg_op = 'INSERT' then
    perform public.enqueue_notification(
      new.customer_id, new.id, 'request_received', 'Request received',
      'We have your request in ' || area || '.',
      '/jobs/' || new.id, 'request-received:' || new.id
    );
    perform public.notify_admins(
      new.id, 'new_request', 'New request',
      'New request in ' || area || '.',
      '/admin/requests/' || new.id, 'new-request:' || new.id
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'quoted' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'quote_ready', 'Your quote is ready',
        'A price is ready for your request in ' || area || '.',
        '/jobs/' || new.id, 'quote-ready:' || new.id
      );
    elsif new.status = 'open' then
      for driver in
        select drivers.profile_id
        from public.drivers
        join public.profiles on profiles.id = drivers.profile_id
        where drivers.is_online
          and drivers.status in ('approved_new', 'active')
          and not profiles.blocked
          and public.coverage_matches(drivers.profile_id, new.pickup_area)
          and not exists (
            select 1 from public.customer_driver_blocks
            where customer_id = new.customer_id and driver_id = drivers.profile_id
          )
      loop
        perform public.enqueue_notification(
          driver, new.id, 'new_job', 'New job nearby',
          'A new job is open in ' || area || '.',
          '/driver', 'new-job:' || new.id
        );
      end loop;
    elsif new.status = 'assigned' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'driver_confirmed', 'Driver confirmed',
        'A driver is confirmed for your request in ' || area || '.',
        '/jobs/' || new.id, 'driver-confirmed:' || new.id
      );
      if new.assigned_driver_id is not null then
        perform public.enqueue_notification(
          new.assigned_driver_id, new.id, 'assigned', 'You are assigned',
          'The customer chose you for a job in ' || area || '.'
            || case when earn is null then '' else ' Your earnings are ' || earn || '.' end,
          '/driver/jobs/' || new.id, 'assigned:' || new.id
        );
      end if;
      if new.payment_status = 'awaiting_payment' then
        due := case
          when new.payment_due_at is null then 'before the driver can start'
          else to_char(new.payment_due_at at time zone 'America/New_York', 'Mon DD, HH12:MI AM') || ' ET'
        end;
        perform public.enqueue_notification(
          new.customer_id, new.id, 'payment_needed', 'Payment needed',
          'Payment is needed ' || due || ' for the job in ' || area || '.',
          '/jobs/' || new.id, 'payment-needed:' || new.id
        );
      end if;
    elsif new.status = 'en_route' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'en_route', 'Driver is on the way',
        'Your driver is heading to the pickup in ' || area || '.',
        '/jobs/' || new.id, 'en-route:' || new.id
      );
    elsif new.status = 'arrived' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'arrived', 'Driver arrived',
        'Your driver arrived for the job in ' || area || '.',
        '/jobs/' || new.id, 'arrived:' || new.id
      );
    elsif new.status = 'item_check' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'item_check', 'Item check',
        'Your driver is checking the item in ' || area || '.',
        '/jobs/' || new.id, 'item-check:' || new.id
      );
    elsif new.status = 'in_transit' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'picked_up',
        case when new.service = 'junk' then 'Load picked up' else 'Item picked up' end,
        case
          when new.service = 'junk' then 'The load was picked up in ' || area || '.'
          else 'Your item was picked up in ' || area || '.'
        end,
        '/jobs/' || new.id, 'picked-up:' || new.id
      );
    elsif new.status = 'delivered' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'delivered',
        case when new.service = 'junk' then 'Hauled away' else 'Delivered' end,
        case
          when new.service = 'junk' then 'The load was hauled away from ' || area || '.'
          else 'Your item was delivered in ' || area || '.'
        end,
        '/jobs/' || new.id, 'delivered:' || new.id
      );
    elsif new.status = 'completed' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'completed', 'Completed',
        'Your job in ' || area || ' is complete.',
        '/jobs/' || new.id, 'completed:' || new.id
      );
    elsif new.status = 'cancelled' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'cancelled', 'Cancelled',
        'The job in ' || area || ' was cancelled.',
        '/jobs/' || new.id, 'cancelled:' || new.id
      );
      if new.assigned_driver_id is not null then
        perform public.enqueue_notification(
          new.assigned_driver_id, new.id, 'cancelled', 'Job cancelled',
          'The job in ' || area || ' was cancelled.',
          '/driver/jobs/' || new.id, 'cancelled:' || new.id
        );
      end if;
    elsif new.status = 'disputed' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'disputed', 'Problem reported',
        'A problem was reported on the job in ' || area || '.',
        '/jobs/' || new.id, 'disputed:' || new.id
      );
      if new.assigned_driver_id is not null then
        perform public.enqueue_notification(
          new.assigned_driver_id, new.id, 'disputed', 'Problem reported',
          'A problem was reported on the job in ' || area || '.',
          '/driver/jobs/' || new.id, 'disputed:' || new.id
        );
      end if;
      perform public.notify_admins(
        new.id, 'disputed', 'Problem reported',
        'A problem was reported on a job in ' || area || '.',
        '/admin/requests/' || new.id, 'disputed:' || new.id
      );
    end if;
  end if;

  if new.payment_status is distinct from old.payment_status
    and new.payment_status = 'authorized' then
    held := case
      when new.price_cents is null then 'your total'
      when new.price_cents % 100 = 0 then '$' || (new.price_cents / 100)::text
      else '$' || trim(to_char(new.price_cents / 100.0, 'FM999999990.00'))
    end;
    perform public.enqueue_notification(
      new.customer_id, new.id, 'payment_confirmed',
      'Booking confirmed — ' || held || ' held on your card, charged after delivery.',
      'Booking confirmed — ' || held || ' held on your card, charged after delivery.',
      '/jobs/' || new.id, 'payment-confirmed:' || new.id
    );
    if new.assigned_driver_id is not null then
      perform public.enqueue_notification(
        new.assigned_driver_id, new.id, 'payment_confirmed',
        'Payment secured — you can start the trip.',
        'Payment secured — you can start the trip.'
          || case when earn is null then '' else ' Your earnings are ' || earn || '.' end,
        '/driver/jobs/' || new.id, 'payment-confirmed:' || new.id
      );
    end if;
  end if;

  return new;
end;
$$;
