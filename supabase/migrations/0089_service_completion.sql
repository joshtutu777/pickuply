-- Regular delivery continues after the item is loaded. Junk removal finishes at the pickup.
-- Existing statuses stay as they are. A job already in progress is not rewritten.
-- Local only until the owner approves a hosted apply.

create or replace function public.stamp_delivery_clock()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    new.delivered_at := coalesce(new.delivered_at, now());
  end if;
  if new.status = 'disputed' and old.status = 'item_check' and new.pickup_review_result is null
    and old.pickup_review_until is not null then
    new.pickup_review_result := 'problem';
    new.pickup_review_closed_at := coalesce(new.pickup_review_closed_at, now());
  end if;
  if new.status = 'in_transit' and old.status = 'item_check' and old.pickup_review_until is not null then
    new.pickup_review_closed_at := coalesce(new.pickup_review_closed_at, now());
    if new.pickup_review_result is null then
      new.pickup_review_result := 'accepted';
    end if;
  end if;
  return new;
end;
$$;

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
  junk_finish boolean;
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

  if next_status = 'at_dropoff' and job_row.status = 'item_check' and job_row.pickup_review_until is not null then
    perform public.close_pickup_review(target_job);
    select * into job_row
    from public.jobs
    where id = target_job and assigned_driver_id = uid
    for update;
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

  junk_finish := job_row.service = 'junk'
    and job_row.status in ('arrived', 'item_check')
    and next_status = 'delivered';

  if not (
    (job_row.status = 'assigned' and next_status = 'en_route')
    or (job_row.status = 'en_route' and next_status = 'arrived')
    or (job_row.status = 'arrived' and next_status = 'item_check')
    or (job_row.status = 'item_check' and next_status = 'in_transit' and job_row.service is distinct from 'junk')
    or junk_finish
    or (job_row.status = 'in_transit' and next_status = 'delivered')
  ) then
    raise exception 'that step is not available';
  end if;

  if next_status = 'item_check' or junk_finish then
    select * into rules from public.proof_rules where service = job_row.service;
    select count(*) into pickup_count
    from public.job_photos
    where job_id = target_job and stage = 'pickup' and report_id is null;
    if rules.pickup_min is null or pickup_count < rules.pickup_min then
      raise exception 'add the pickup photo first';
    end if;
  end if;

  if junk_finish and coalesce(public.disposal_receipt_required(target_job), false) and not exists (
    select 1 from public.job_photos
    where job_id = target_job and stage = 'dump_receipt' and report_id is null
  ) then
    raise exception 'add the disposal receipt first';
  end if;

  if next_status = 'delivered' and not junk_finish then
    select * into rules from public.proof_rules where service = job_row.service;
    select count(*) into dropoff_count
    from public.job_photos
    where job_id = target_job and stage = 'dropoff' and report_id is null;
    if rules.dropoff_min is null or dropoff_count < rules.dropoff_min then
      raise exception 'add the delivery photo first';
    end if;
    if coalesce(public.disposal_receipt_required(target_job), false) and not exists (
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
      pickup_review_closed_at = case
        when job_row.status = 'item_check' and next_status = 'in_transit' and pickup_review_until is not null
          then coalesce(pickup_review_closed_at, now())
        else pickup_review_closed_at
      end,
      pickup_review_result = case
        when job_row.status = 'item_check'
          and next_status = 'in_transit'
          and pickup_review_until is not null
          and pickup_review_result is null
          then 'timeout'
        else pickup_review_result
      end
  where id = target_job;
end;
$$;

create or replace function public.approve_pickup(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  rules public.proof_rules%rowtype;
  pickup_count integer;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from uid then
    raise exception 'only the customer can approve the item';
  end if;
  if job_row.status is distinct from 'item_check' then
    raise exception 'the item is not ready for approval';
  end if;
  if job_row.pickup_review_until is null then
    raise exception 'the driver continues without a pickup approval';
  end if;
  if exists (select 1 from public.job_disputes where job_id = target_job and resolved_at is null) then
    raise exception 'this job is on hold';
  end if;
  select * into rules from public.proof_rules where service = job_row.service;
  select count(*) into pickup_count
  from public.job_photos
  where job_id = target_job and stage = 'pickup' and report_id is null;
  if rules.pickup_min is null or pickup_count < rules.pickup_min then
    raise exception 'the pickup photo is not ready';
  end if;

  update public.jobs set status = 'in_transit' where id = target_job;
  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, uid, 'pickup_approved', jsonb_build_object('to', 'in_transit'));
  perform public.enqueue_notification(
    job_row.assigned_driver_id, target_job, 'pickup_approved',
    'Item approved',
    'The customer approved the item. You can continue.',
    '/driver/jobs/' || target_job::text,
    'pickup-approved:' || target_job::text
  );
end;
$$;

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
  junk boolean := new.service = 'junk';
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
        driver_name || case when junk then ' has arrived at the removal location.' else ' has arrived at pickup.' end,
        '/jobs/' || new.id, 'arrived:' || new.id
      );
    elsif new.status = 'item_check' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'item_check', 'Item loaded',
        'Your item is loaded. The driver can continue to the drop-off.',
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
        new.customer_id, new.id, 'delivered', 'Does everything look good?',
        case
          when junk then 'Does everything look good? Confirm the removal, or report an issue. If you do not respond, this finishes 24 hours after the junk was removed.'
          else 'Does everything look good? Confirm the delivery, or report an issue. If you do not respond, this finishes 24 hours after delivery.'
        end,
        '/jobs/' || new.id, 'delivered:' || new.id
      );
    elsif new.status = 'completed' then
      perform public.enqueue_notification(
        new.customer_id, new.id, 'completed',
        case when junk then 'Removal completed' else 'Delivery completed' end,
        case
          when junk then 'The removal is complete. Your receipt is ready, and you can leave a review.'
          else 'Delivery completed. Your receipt is ready, and you can leave a review.'
        end,
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
