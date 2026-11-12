-- During the pilot, a driver offer does not expire on a clock.
-- It stays active until the customer chooses a driver, the driver withdraws it,
-- or the request leaves the open state. Prices, payment, and the booking lock are unchanged.
-- This does not change existing offer rows.

drop function if exists public.submit_offer(uuid, text, integer, text);
drop function if exists public.submit_offer(uuid, text, integer, text, text, text, uuid);

create function public.submit_offer(
  target_job uuid,
  kind text,
  earnings_cents integer,
  reason text,
  proposed_date text default null,
  proposed_time text default null,
  window_id uuid default null
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
  sched_start timestamptz;
  sched_end timestamptz;
  sched_window uuid;
  offer_amount integer;
begin
  perform public.assert_driver_can_take_job(target_job, 'offer');
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
  if job_row.pricing_method = 'quote' and job_row.driver_pay_cents is not null then
    raise exception 'a quote is claimed after the customer accepts it';
  elsif job_row.pricing_method = 'quote' then
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
  select picked.start_at, picked.end_at, picked.chosen_window
    into sched_start, sched_end, sched_window
    from public.offer_schedule(target_job, proposed_date, proposed_time, window_id) as picked;
  perform set_config('pickuply.schedule_write', 'yes', true);
  insert into public.job_offers (
    job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents,
    customer_total_cents, commission_bps, reason, outside_range, status, expires_at,
    proposed_pickup_start, proposed_pickup_end, pickup_window_id
  ) values (
    target_job, uid, offer_kind,
    (breakdown->>'driver_earnings_cents')::integer,
    (breakdown->>'platform_fee_cents')::integer,
    (breakdown->>'service_fee_cents')::integer,
    (breakdown->>'customer_total_cents')::integer,
    (breakdown->>'commission_bps')::integer,
    nullif(btrim(coalesce(reason, '')), ''),
    outside, 'active', null, sched_start, sched_end, sched_window
  )
  returning id into offer_id;
  perform set_config('pickuply.schedule_write', '', true);
  return offer_id;
end;
$function$;

revoke all on function public.submit_offer(uuid, text, integer, text, text, text, uuid) from public, anon, service_role;
grant execute on function public.submit_offer(uuid, text, integer, text, text, text, uuid) to authenticated;

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
  if not found or offer_row.status <> 'active' or offer_row.unavailable_at is not null then
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
  if not found or offer_row.status <> 'active' or offer_row.unavailable_at is not null then
    raise exception 'that offer is no longer available';
  end if;
  perform set_config('pickuply.offer_chosen', 'yes', true);
  update public.job_offers set status = 'chosen' where id = target_offer;
  update public.job_offers
  set status = 'declined'
  where job_id = offer_row.job_id and id <> target_offer and status = 'active';
  perform public.assert_saved_schedule(offer_row, job_row);
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

drop function if exists public.offer_summaries(uuid);

create function public.offer_summaries(target_job uuid)
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
  expires_at timestamptz,
  viewed boolean,
  rating_avg numeric,
  review_count integer,
  proposed_pickup_start timestamptz,
  proposed_pickup_end timestamptz,
  pickup_window_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $function$
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
    (
      select count(*)::integer
      from public.jobs finished
      where finished.assigned_driver_id = offers.driver_id
        and finished.status = 'completed'
    ),
    offers.reason,
    offers.outside_range,
    offers.customer_total_cents,
    offers.driver_amount_cents,
    offers.platform_fee_cents,
    offers.service_fee_cents,
    offers.status,
    offers.expires_at,
    exists (
      select 1 from public.offer_views
      where offer_views.offer_id = offers.id
    ),
    (
      select round(avg(reviews.stars)::numeric, 1)
      from public.job_reviews reviews
      where reviews.reviewee_id = offers.driver_id
        and reviews.reviewer_role = 'customer'
        and reviews.hidden_at is null
        and public.review_is_published(reviews.job_id, reviews.created_at)
    ),
    (
      select count(*)::integer
      from public.job_reviews reviews
      where reviews.reviewee_id = offers.driver_id
        and reviews.reviewer_role = 'customer'
        and reviews.hidden_at is null
        and public.review_is_published(reviews.job_id, reviews.created_at)
    ),
    offers.proposed_pickup_start,
    offers.proposed_pickup_end,
    offers.pickup_window_id
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
    and offers.status = 'active';
end;
$function$;

revoke all on function public.offer_summaries(uuid) from public, anon, service_role;
grant execute on function public.offer_summaries(uuid) to authenticated;

create or replace function public.customer_offer_counts()
returns table (job_id uuid, active_offers integer, new_offers integer)
language sql
stable
security definer
set search_path = public
as $function$
  select
    jobs.id,
    count(offers.id) filter (
      where offers.status = 'active'
    )::integer,
    count(offers.id) filter (
      where offers.status = 'active'
        and views.offer_id is null
    )::integer
  from public.jobs
  left join public.job_offers offers on offers.job_id = jobs.id
  left join public.offer_views views on views.offer_id = offers.id
  where jobs.customer_id = auth.uid()
  group by jobs.id;
$function$;

create or replace function public.guard_active_offer_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
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
      and id is distinct from new.id
  ) >= 5 then
    raise exception 'this job already has five active offers';
  end if;
  return new;
end;
$function$;

-- A request that is no longer open cannot keep a choosable offer.
-- Choosing a driver already marks the other offers declined before the job changes.
create or replace function public.close_offers_when_request_leaves_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if old.status = 'open' and new.status is distinct from 'open' then
    update public.job_offers
    set status = 'declined'
    where job_id = new.id and status = 'active';
  end if;
  return new;
end;
$function$;

revoke all on function public.close_offers_when_request_leaves_open() from public, anon, authenticated, service_role;

drop trigger if exists jobs_close_offers on public.jobs;
create trigger jobs_close_offers
  after update of status on public.jobs
  for each row execute function public.close_offers_when_request_leaves_open();
