-- Delivery steps stay on the existing statuses.
-- item_check is the 10-minute pickup review. in_transit is the trip to the drop-off.
-- Arriving at the drop-off records a timestamp. It does not add a second status.
-- Local only until the owner approves a hosted apply.

alter table public.jobs
  add column if not exists pickup_review_until timestamptz,
  add column if not exists pickup_review_closed_at timestamptz,
  add column if not exists pickup_review_result text,
  add column if not exists dropoff_arrived_at timestamptz,
  add column if not exists delivered_at timestamptz;

alter table public.jobs
  drop constraint if exists jobs_pickup_review_result;

alter table public.jobs
  add constraint jobs_pickup_review_result check (
    pickup_review_result is null
    or pickup_review_result in ('accepted', 'timeout', 'problem')
  );

update public.jobs
set delivered_at = coalesce(
  delivered_at,
  (
    select min(created_at)
    from public.job_events
    where job_events.job_id = jobs.id
      and job_events.type = 'status'
      and job_events.data->>'to' = 'delivered'
  ),
  updated_at
)
where status in ('delivered', 'completed')
  and delivered_at is null;

alter type public.photo_stage add value if not exists 'no_show';

create or replace function public.stamp_delivery_clock()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    new.delivered_at := coalesce(new.delivered_at, now());
  end if;
  if new.status = 'disputed' and old.status = 'item_check' and new.pickup_review_result is null then
    new.pickup_review_result := 'problem';
    new.pickup_review_closed_at := coalesce(new.pickup_review_closed_at, now());
  end if;
  if new.status = 'in_transit' and old.status = 'item_check' then
    new.pickup_review_closed_at := coalesce(new.pickup_review_closed_at, now());
    if new.pickup_review_result is null then
      new.pickup_review_result := 'accepted';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_stamp_delivery_clock on public.jobs;
create trigger jobs_stamp_delivery_clock
  before update on public.jobs
  for each row execute function public.stamp_delivery_clock();

create or replace function public.advance_job(target_job uuid, next_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  rules public.proof_rules%rowtype;
  dropoff_count integer;
  pickup_count integer;
  driver_name text := 'Your driver';
begin
  if uid is null then
    raise exception 'sign in required';
  end if;

  select * into job_row
  from public.jobs
  where id = target_job and assigned_driver_id = uid
  for update;

  if not found then
    raise exception 'only the assigned driver can update this job';
  end if;

  if job_row.test_retired_at is not null or job_row.status in ('cancelled', 'disputed', 'completed') then
    raise exception 'that step is not available';
  end if;

  if public.account_is_suspended(uid) and job_row.status is distinct from 'in_transit' then
    raise exception 'This booking requires assistance from Pickuply support.';
  end if;

  if next_status = 'at_dropoff' then
    if job_row.status is distinct from 'in_transit' then
      raise exception 'that step is not available';
    end if;
    if job_row.dropoff_arrived_at is not null then
      return;
    end if;
    update public.jobs set dropoff_arrived_at = now() where id = target_job;
    insert into public.job_events (job_id, actor_id, type, data)
    values (target_job, uid, 'dropoff_arrived', jsonb_build_object('to', 'at_dropoff'));
    select coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'Your driver')
    into driver_name
    from public.profiles
    where id = uid;
    perform public.enqueue_notification(
      job_row.customer_id, target_job, 'dropoff_arrived', 'Driver arrived',
      driver_name || ' has arrived. Please meet them.',
      '/jobs/' || target_job::text,
      'dropoff-arrived:' || target_job::text
    );
    return;
  end if;

  if not (
    (job_row.status = 'assigned' and next_status = 'en_route')
    or (job_row.status = 'en_route' and next_status = 'arrived')
    or (job_row.status = 'arrived' and next_status = 'item_check')
    or (job_row.status = 'in_transit' and next_status = 'delivered')
  ) then
    raise exception 'that step is not available';
  end if;

  if next_status = 'item_check' then
    select * into rules from public.proof_rules where service = job_row.service;
    select count(*) into pickup_count
    from public.job_photos
    where job_id = target_job and stage = 'pickup' and report_id is null;
    if rules.pickup_min is null or pickup_count < rules.pickup_min then
      raise exception 'add the pickup photo first';
    end if;
  end if;

  if next_status = 'delivered' then
    select * into rules from public.proof_rules where service = job_row.service;
    select count(*) into dropoff_count
    from public.job_photos
    where job_id = target_job and stage = 'dropoff' and report_id is null;
    if rules.dropoff_min is null or dropoff_count < rules.dropoff_min then
      raise exception 'add the delivery photo first';
    end if;
    if job_row.service = 'junk' and job_row.require_disposal_receipt and not exists (
      select 1 from public.job_photos
      where job_id = target_job and stage = 'dump_receipt' and report_id is null
    ) then
      raise exception 'add the disposal receipt first';
    end if;
    if job_row.dropoff_arrived_at is null then
      raise exception 'that step is not available';
    end if;
  end if;

  update public.jobs
  set status = next_status::public.job_status,
      pickup_review_until = case
        when next_status = 'item_check' then now() + interval '10 minutes'
        else pickup_review_until
      end
  where id = target_job;
end;
$$;

create or replace function public.close_pickup_review(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
begin
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.status is distinct from 'item_check' then
    return;
  end if;
  if job_row.pickup_review_until is null or job_row.pickup_review_until > now() then
    return;
  end if;
  if exists (
    select 1 from public.job_disputes
    where job_id = target_job and resolved_at is null
  ) then
    return;
  end if;
  if uid is not null
    and uid is distinct from job_row.customer_id
    and uid is distinct from job_row.assigned_driver_id
    and not public.is_admin() then
    raise exception 'only the customer or assigned driver can close this review';
  end if;

  update public.jobs
  set status = 'in_transit',
      pickup_review_closed_at = now(),
      pickup_review_result = 'timeout'
  where id = target_job and status = 'item_check';
end;
$$;

create or replace function public.close_expired_pickup_reviews()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  closed_count integer := 0;
  job_id uuid;
begin
  for job_id in
    select id
    from public.jobs
    where status = 'item_check'
      and pickup_review_until is not null
      and pickup_review_until <= now()
    for update skip locked
  loop
    perform public.close_pickup_review(job_id);
    closed_count := closed_count + 1;
  end loop;
  return closed_count;
end;
$$;

revoke all on function public.close_pickup_review(uuid) from public, anon, service_role;
grant execute on function public.close_pickup_review(uuid) to authenticated, service_role;

revoke all on function public.close_expired_pickup_reviews() from public, anon, authenticated;
grant execute on function public.close_expired_pickup_reviews() to service_role;

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
  if not found or job_row.assigned_driver_id is distinct from uid then
    raise exception 'wait until you have arrived';
  end if;
  if job_row.no_show_pending then
    return;
  end if;

  if job_row.status = 'arrived' then
    select min(created_at) into arrived_at
    from public.job_events
    where job_id = target_job and type = 'status' and data->>'to' = 'arrived';
    if coalesce(arrived_at, job_row.updated_at) > now() - interval '15 minutes' then
      raise exception 'wait 15 minutes after arriving';
    end if;
  elsif job_row.status = 'in_transit' and job_row.dropoff_arrived_at is not null then
    if job_row.dropoff_arrived_at > now() - interval '15 minutes' then
      raise exception 'wait 15 minutes after arriving';
    end if;
  else
    raise exception 'wait until you have arrived';
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

create or replace function public.record_proof(
  target_job uuid,
  photo_stage text,
  storage_path text,
  photo_note text,
  media_kind text,
  share_location boolean,
  raw_lat numeric,
  raw_lng numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job public.jobs%rowtype;
  rules public.proof_rules%rowtype;
  photo_id uuid;
  stage_count integer;
  stage_max integer;
  location_on boolean;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if photo_stage not in ('pickup', 'dropoff', 'dump_receipt', 'no_show') then
    raise exception 'that proof step is not available';
  end if;
  if media_kind not in ('photo', 'video') then
    raise exception 'choose a photo or a short video';
  end if;
  if storage_path !~ (
    '^' || target_job::text || '/' || photo_stage || '/[0-9a-f-]{36}\.(jpg|jpeg|webp|webm)$'
  ) then
    raise exception 'proof file path is not valid';
  end if;

  select * into job from public.jobs where id = target_job;
  if job.id is null then
    raise exception 'job not found';
  end if;
  if uid is distinct from job.assigned_driver_id and not public.is_admin() then
    raise exception 'only the assigned driver can add proof';
  end if;
  if photo_stage = 'no_show'
    and job.status is distinct from 'arrived'
    and not (job.status = 'in_transit' and job.dropoff_arrived_at is not null) then
    raise exception 'that proof step is not available';
  end if;

  select * into rules from public.proof_rules where service = job.service;
  select count(*) into stage_count
  from public.job_photos
  where job_id = target_job and stage = photo_stage::public.photo_stage;
  stage_max := case photo_stage
    when 'pickup' then rules.pickup_max
    when 'dropoff' then rules.dropoff_max
    else 3
  end;
  if stage_count >= stage_max then
    raise exception 'this step already has the maximum number of files';
  end if;

  perform set_config('pickuply.record_proof', 'yes', true);
  insert into public.job_photos (job_id, stage, storage_path, uploaded_by, captured_at, note, media_kind)
  values (
    target_job,
    photo_stage::public.photo_stage,
    storage_path,
    uid,
    now(),
    nullif(btrim(coalesce(photo_note, '')), ''),
    media_kind
  )
  returning id into photo_id;
  perform set_config('pickuply.record_proof', 'no', true);

  select proof_location_enabled into location_on from public.platform_settings where id = 1;
  if coalesce(share_location, false)
    and coalesce(location_on, false)
    and raw_lat is not null
    and raw_lng is not null
    and raw_lat between -90 and 90
    and raw_lng between -180 and 180 then
    insert into public.proof_locations (photo_id, approximate_lat, approximate_lng)
    values (photo_id, round(raw_lat, 2), round(raw_lng, 2));
  end if;

  return photo_id;
end;
$$;

create or replace function public.guard_proof_insert()
returns trigger
language plpgsql
as $$
begin
  if new.stage in ('pickup', 'dropoff', 'dump_receipt', 'no_show')
    and current_setting('pickuply.record_proof', true) is distinct from 'yes' then
    raise exception 'use the proof step';
  end if;
  return new;
end;
$$;

drop policy if exists job_photos_storage_assigned_insert on storage.objects;
create policy job_photos_storage_assigned_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-photos'
    and public.storage_stage(name) in ('pickup', 'dropoff', 'dump_receipt', 'no_show')
    and public.is_assigned_driver(public.storage_job_id(name))
  );

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
      or coalesce(job_row.delivered_at, job_row.updated_at) < now() - make_interval(hours => hours)
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
  driver_name text := 'Your driver';
  earn text := case
    when new.driver_pay_cents is null then null
    when new.driver_pay_cents % 100 = 0 then '$' || (new.driver_pay_cents / 100)::text
    else '$' || trim(to_char(new.driver_pay_cents / 100.0, 'FM999999990.00'))
  end;
begin
  if new.assigned_driver_id is not null then
    select coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'Your driver')
    into driver_name
    from public.profiles
    where id = new.assigned_driver_id;
  end if;

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
        driver_name || ' is on the way to pickup.',
        '/jobs/' || new.id, 'en-route:' || new.id
      );
    elsif new.status = 'arrived' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'arrived', 'Driver arrived',
        driver_name || ' has arrived at pickup.',
        '/jobs/' || new.id, 'arrived:' || new.id
      );
    elsif new.status = 'item_check' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'item_check', 'Item picked up',
        'Your item is picked up. Something wrong? Tell us within 10 minutes.',
        '/jobs/' || new.id, 'item-check:' || new.id
      );
    elsif new.status = 'in_transit' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'picked_up', 'Delivery proceeding',
        'Your item is on the way.',
        '/jobs/' || new.id, 'picked-up:' || new.id
      );
    elsif new.status = 'delivered' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'delivered', 'Confirm your delivery',
        'Confirm your delivery. If you do not respond, this finishes 24 hours after delivery.',
        '/jobs/' || new.id, 'delivered:' || new.id
      );
    elsif new.status = 'completed' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'completed', 'Delivery completed',
        'Delivery completed. Your receipt is ready, and you can leave a review.',
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
        'Delivery paused while Pickuply reviews your report.',
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
