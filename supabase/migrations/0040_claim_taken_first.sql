-- A taken job is reported before driver eligibility. A second eligible driver
-- then hears that the job is already taken, instead of looking ineligible.

create or replace function public.claim_job(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;

  select * into job_row
  from public.jobs
  where id = target_job
  for update;

  if not found or job_row.status <> 'open' or job_row.pricing_method <> 'quote' then
    raise exception 'job already taken';
  end if;

  perform public.assert_driver_can_take_job(target_job, 'claim');

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

  select * into offer_row from public.job_offers where id = target_offer;
  if not found or offer_row.status <> 'active' or offer_row.expires_at <= now() then
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
  if not found or offer_row.status <> 'active' or offer_row.expires_at <= now() then
    raise exception 'that offer is no longer available';
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
