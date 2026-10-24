-- One booking notice per person. The trigger owns the copy; apply_authorization no longer sends a second pair.

create or replace function public.apply_authorization(
  target_job uuid,
  payment_intent text,
  charge_id text,
  capture_before timestamptz,
  checkout_driver uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  stored_intent text;
begin
  if payment_intent is null or payment_intent !~ '^pi_[A-Za-z0-9]+$' then
    raise exception 'payment intent is missing';
  end if;
  if charge_id is not null and charge_id !~ '^ch_[A-Za-z0-9]+$' then
    raise exception 'charge id is not valid';
  end if;

  select * into job_row from public.jobs where id = target_job for update;
  if not found then
    return 'missing';
  end if;

  select job_payments.payment_intent_id into stored_intent
  from public.job_payments where job_id = target_job;

  if job_row.payment_status in ('authorized', 'paid', 'captured') then
    if stored_intent is not distinct from payment_intent then
      return 'accepted';
    end if;
    return 'duplicate';
  end if;

  if job_row.payment_due_at is not null and job_row.payment_due_at < now()
    and (
      job_row.status is distinct from 'assigned'
      or job_row.assigned_driver_id is distinct from checkout_driver
    ) then
    insert into public.payment_attempts (job_id, payment_intent_id, outcome)
    values (target_job, payment_intent, 'released_late');
    perform public.enqueue_notification(
      job_row.customer_id, target_job, 'payment_released',
      'Card hold released',
      'A card was approved after this job was reopened. The hold was released and you were not charged.',
      '/jobs/' || target_job::text,
      'payment-late:' || payment_intent
    );
    perform public.notify_admins(
      target_job, 'payment_released',
      'Late card authorization released',
      'A card was approved after the job was reopened or reassigned. The hold was released.',
      '/admin/requests/' || target_job::text,
      'payment-late-admin:' || payment_intent
    );
    return 'released_late';
  end if;

  if job_row.status is distinct from 'assigned'
    or job_row.assigned_driver_id is distinct from checkout_driver
    or job_row.payment_status not in ('awaiting_payment', 'failed') then
    insert into public.payment_attempts (job_id, payment_intent_id, outcome)
    values (target_job, payment_intent, 'released_late');
    perform public.enqueue_notification(
      job_row.customer_id, target_job, 'payment_released',
      'Card hold released',
      'This job is no longer waiting on that payment. The hold was released and you were not charged.',
      '/jobs/' || target_job::text,
      'payment-late:' || payment_intent
    );
    perform public.notify_admins(
      target_job, 'payment_released',
      'Card authorization released',
      'A card was approved for a job that is no longer assigned to that driver. The hold was released.',
      '/admin/requests/' || target_job::text,
      'payment-late-admin:' || payment_intent
    );
    return 'released_late';
  end if;

  perform set_config('pickuply.system_payment', 'yes', true);
  update public.jobs set payment_status = 'authorized' where id = target_job;
  update public.job_payments
  set payment_intent_id = payment_intent,
      charge_id = apply_authorization.charge_id,
      capture_before = apply_authorization.capture_before,
      updated_at = now()
  where job_id = target_job;

  insert into public.payment_attempts (job_id, payment_intent_id, outcome)
  values (target_job, payment_intent, 'authorized');
  insert into public.job_events (job_id, actor_id, type, data)
  values (
    target_job, null, 'payment_authorized',
    jsonb_build_object('payment_intent_id', payment_intent)
  );
  return 'accepted';
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
          'The customer chose you for a job in ' || area || '.',
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
        'Payment secured — you can start the trip.',
        '/driver/jobs/' || new.id, 'payment-confirmed:' || new.id
      );
    end if;
  end if;

  return new;
end;
$$;
