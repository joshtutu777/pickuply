-- In-app notifications, device push subscriptions, and the SMS on/off switch.
-- Texting stays off until an admin turns sms_enabled on.
-- Do not apply this file to the hosted project until the owner approves it.

alter table public.platform_settings
  add column sms_enabled boolean not null default false;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  href text not null,
  dedupe_key text not null,
  read_at timestamptz,
  push_sent_at timestamptz,
  email_sent_at timestamptz,
  sms_sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_dedupe unique (profile_id, dedupe_key),
  constraint notifications_text_length check (char_length(title) <= 120 and char_length(body) <= 400),
  constraint notifications_href check (href ~ '^/')
);

create index notifications_profile_created_idx
  on public.notifications (profile_id, created_at desc);

create table public.notification_preferences (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  push_enabled boolean not null default true,
  email_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  home_screen_hint_dismissed boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint check (endpoint ~ '^https://')
);

alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (profile_id = auth.uid());

create policy notification_preferences_select_own on public.notification_preferences
  for select to authenticated
  using (profile_id = auth.uid());

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (profile_id = auth.uid());

create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (profile_id = auth.uid());

create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated
  using (profile_id = auth.uid());

create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

grant select on public.notifications to authenticated;
grant select on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create or replace function public.enqueue_notification(
  recipient uuid,
  target_job uuid,
  kind text,
  title text,
  body text,
  href text,
  dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if recipient is null or coalesce(dedupe_key, '') = '' then
    return;
  end if;
  insert into public.notifications (profile_id, job_id, kind, title, body, href, dedupe_key)
  values (
    recipient,
    target_job,
    left(kind, 80),
    left(title, 120),
    left(body, 400),
    href,
    dedupe_key
  )
  on conflict (profile_id, dedupe_key) do nothing;
end;
$$;

revoke all on function public.enqueue_notification(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.notify_admins(
  target_job uuid,
  kind text,
  title text,
  body text,
  href text,
  dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid;
begin
  for admin_id in select id from public.profiles where role = 'admin' loop
    perform public.enqueue_notification(admin_id, target_job, kind, title, body, href, dedupe_key);
  end loop;
end;
$$;

revoke all on function public.notify_admins(uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;

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
    elsif new.status = 'open' and new.zone_id is not null then
      for driver in
        select drivers.profile_id
        from public.drivers
        where drivers.is_online
          and drivers.status in ('approved_new', 'active')
          and drivers.zone_id = new.zone_id
          and new.service = any (drivers.services)
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
    and new.payment_status in ('authorized', 'paid', 'captured') then
    perform public.enqueue_notification(
      new.customer_id, new.id, 'payment_confirmed', 'Payment confirmed',
      'Payment is confirmed for the job in ' || area || '.',
      '/jobs/' || new.id, 'payment-confirmed:' || new.id
    );
    if new.assigned_driver_id is not null then
      perform public.enqueue_notification(
        new.assigned_driver_id, new.id, 'payment_confirmed', 'Payment confirmed',
        'Payment is confirmed. You can start the job in ' || area || '.',
        '/driver/jobs/' || new.id, 'payment-confirmed:' || new.id
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger jobs_notify
  after insert or update of status, payment_status on public.jobs
  for each row execute function public.notify_on_job();

create or replace function public.notify_on_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  customer uuid;
  area text;
begin
  select jobs.customer_id, left(jobs.pickup_area, 80)
  into customer, area
  from public.jobs
  where jobs.id = new.job_id;

  if customer is null then
    return new;
  end if;

  perform public.enqueue_notification(
    customer, new.job_id, 'offer', 'New offer',
    'A driver sent an offer on your request in ' || coalesce(area, 'your area') || '.',
    '/jobs/' || new.job_id, 'offer:' || new.id
  );
  return new;
end;
$$;

create trigger job_offers_notify
  after insert on public.job_offers
  for each row execute function public.notify_on_offer();

create or replace function public.notify_on_driver_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'pending_review' then
      perform public.notify_admins(
        null, 'driver_application', 'New driver application',
        'A driver application is waiting for review.',
        '/admin/drivers/' || new.profile_id, 'driver-application:' || new.profile_id
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger drivers_notify_application
  after insert or update of status on public.drivers
  for each row execute function public.notify_on_driver_application();

create or replace function public.scan_notification_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.jobs%rowtype;
  opened timestamptz;
begin
  for job in
    select *
    from public.jobs
    where status = 'open'
  loop
    select min(job_events.created_at)
    into opened
    from public.job_events
    where job_events.job_id = job.id
      and job_events.type = 'status'
      and job_events.data->>'to' = 'open';

    if coalesce(opened, job.created_at) > now() - interval '20 minutes' then
      continue;
    end if;
    if exists (select 1 from public.job_offers where job_id = job.id) then
      continue;
    end if;
    perform public.notify_admins(
      job.id, 'no_offers', 'No offers yet',
      'A job in ' || left(job.pickup_area, 80) || ' has been open for 20 minutes with no offers.',
      '/admin/requests/' || job.id, 'no-offers:' || job.id
    );
  end loop;

  for job in
    select *
    from public.jobs
    where status = 'assigned'
      and payment_status = 'awaiting_payment'
      and payment_due_at is not null
      and payment_due_at < now()
  loop
    perform public.notify_admins(
      job.id, 'payment_deadline', 'Payment deadline missed',
      'Payment was not completed for a job in ' || left(job.pickup_area, 80) || '.',
      '/admin/requests/' || job.id, 'payment-deadline:' || job.id
    );
  end loop;
end;
$$;

revoke all on function public.scan_notification_reminders() from public, anon, authenticated;
grant execute on function public.scan_notification_reminders() to service_role;

create or replace function public.mark_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  update public.notifications
  set read_at = now()
  where profile_id = auth.uid()
    and read_at is null;
end;
$$;

revoke all on function public.mark_notifications_read() from public, anon, service_role;
grant execute on function public.mark_notifications_read() to authenticated;

create or replace function public.save_notification_preferences(
  push_on boolean,
  email_on boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  insert into public.notification_preferences (profile_id, push_enabled, email_enabled, sms_enabled)
  values (auth.uid(), coalesce(push_on, true), coalesce(email_on, true), false)
  on conflict (profile_id) do update
  set push_enabled = excluded.push_enabled,
      email_enabled = excluded.email_enabled,
      sms_enabled = false,
      updated_at = now();
end;
$$;

revoke all on function public.save_notification_preferences(boolean, boolean) from public, anon, service_role;
grant execute on function public.save_notification_preferences(boolean, boolean) to authenticated;

create or replace function public.dismiss_home_screen_hint()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  insert into public.notification_preferences (profile_id, home_screen_hint_dismissed)
  values (auth.uid(), true)
  on conflict (profile_id) do update
  set home_screen_hint_dismissed = true,
      updated_at = now();
end;
$$;

revoke all on function public.dismiss_home_screen_hint() from public, anon, service_role;
grant execute on function public.dismiss_home_screen_hint() to authenticated;

create or replace function public.set_sms_enabled(enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can change settings';
  end if;
  update public.platform_settings
  set sms_enabled = coalesce(enabled, false),
      updated_at = now()
  where id = 1;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'set_sms_enabled',
    'platform_settings',
    null,
    jsonb_build_object('sms_enabled', coalesce(enabled, false))
  );
end;
$$;

revoke all on function public.set_sms_enabled(boolean) from public, anon, service_role;
grant execute on function public.set_sms_enabled(boolean) to authenticated;
