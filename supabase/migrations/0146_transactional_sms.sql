-- Transactional booking texts. Not applied. Sending stays off until
-- transactional_sms_enabled_at is set by an admin.

alter table public.platform_settings
  add column if not exists driver_job_sms_audience text not null default 'eligible',
  add column if not exists transactional_sms_enabled_at timestamptz,
  add column if not exists transactional_pilot_only boolean not null default true;

alter table public.platform_settings
  drop constraint if exists platform_settings_driver_job_sms_audience_check;

alter table public.platform_settings
  add constraint platform_settings_driver_job_sms_audience_check
    check (driver_job_sms_audience in ('eligible', 'online', 'off'));

-- The admin phone and the pilot list are not on the settings row every signed-in person can read.
create table if not exists public.booking_text_private (
  id integer primary key check (id = 1),
  admin_alert_phone text,
  pilot_profile_ids uuid[] not null default '{}',
  constraint booking_text_private_phone_e164
    check (admin_alert_phone is null or admin_alert_phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$')
);

insert into public.booking_text_private (id)
values (1)
on conflict (id) do nothing;

alter table public.booking_text_private enable row level security;

revoke all on public.booking_text_private from public, anon, authenticated;
grant select on public.booking_text_private to authenticated;

drop policy if exists booking_text_private_admin_select on public.booking_text_private;
create policy booking_text_private_admin_select
  on public.booking_text_private
  for select
  to authenticated
  using (public.is_admin());

alter table public.notifications
  add column if not exists transactional_checked_at timestamptz;

create table if not exists public.transactional_sms (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  notification_id uuid references public.notifications (id) on delete set null,
  profile_id uuid references public.profiles (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  kind text not null,
  body text not null,
  to_phone text,
  status text not null default 'queued',
  skip_reason text,
  provider_sid text,
  error_code text,
  claimed_at timestamptz,
  attempt_count integer not null default 0,
  send_started_at timestamptz,
  retryable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactional_sms_status_check
    check (status in ('queued', 'skipped', 'failed', 'accepted', 'delivered', 'undelivered')),
  constraint transactional_sms_phone_e164
    check (to_phone is null or to_phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$')
);

create index if not exists transactional_sms_created_idx
  on public.transactional_sms (created_at desc);
create index if not exists transactional_sms_job_idx
  on public.transactional_sms (job_id, created_at desc);
create index if not exists transactional_sms_provider_idx
  on public.transactional_sms (provider_sid);

alter table public.transactional_sms enable row level security;

revoke all on public.transactional_sms from public, anon, authenticated;
grant select on public.transactional_sms to authenticated;

drop policy if exists transactional_sms_admin_select on public.transactional_sms;
create policy transactional_sms_admin_select
  on public.transactional_sms
  for select
  to authenticated
  using (public.is_admin());

-- A driver confirms they will start. Opening an in-app alert does not call this.
create or replace function public.acknowledge_assignment(target_job uuid)
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
  select * into job_row from public.jobs where id = target_job;
  if not found or job_row.assigned_driver_id is distinct from auth.uid() then
    raise exception 'not assigned';
  end if;
  if job_row.payment_status not in ('authorized', 'paid', 'captured') then
    raise exception 'payment is not secured';
  end if;
  if exists (
    select 1 from public.job_events
    where job_id = target_job
      and type = 'driver_acknowledged'
      and actor_id = auth.uid()
  ) then
    return;
  end if;
  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, auth.uid(), 'driver_acknowledged', '{}'::jsonb);
end;
$$;

revoke all on function public.acknowledge_assignment(uuid) from public, anon, service_role;
grant execute on function public.acknowledge_assignment(uuid) to authenticated;

create or replace function public.set_transactional_alerts(
  phone text,
  audience text,
  turn_on boolean,
  pilot_only boolean default true,
  pilot_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text;
begin
  if not public.is_admin() then
    raise exception 'only an admin can change settings';
  end if;
  if audience not in ('eligible', 'online', 'off') then
    raise exception 'audience is not valid';
  end if;
  cleaned := nullif(regexp_replace(coalesce(phone, ''), '\s', '', 'g'), '');
  if cleaned is not null and cleaned !~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$' then
    raise exception 'phone is not valid';
  end if;
  update public.platform_settings
  set driver_job_sms_audience = audience,
      transactional_pilot_only = coalesce(pilot_only, true),
      transactional_sms_enabled_at = case
        when coalesce(turn_on, false) then coalesce(transactional_sms_enabled_at, now())
        else null
      end,
      updated_at = now()
  where id = 1;
  insert into public.booking_text_private (id, admin_alert_phone, pilot_profile_ids)
  values (1, cleaned, coalesce(pilot_ids, '{}'))
  on conflict (id) do update
    set admin_alert_phone = excluded.admin_alert_phone,
        pilot_profile_ids = excluded.pilot_profile_ids;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'set_transactional_alerts',
    'platform_settings',
    null,
    jsonb_build_object(
      'audience', audience,
      'enabled', coalesce(turn_on, false),
      'phone_set', cleaned is not null,
      'pilot_only', coalesce(pilot_only, true),
      'pilot_count', coalesce(cardinality(pilot_ids), 0)
    )
  );
end;
$$;

revoke all on function public.set_transactional_alerts(text, text, boolean, boolean, uuid[]) from public, anon, service_role;
grant execute on function public.set_transactional_alerts(text, text, boolean, boolean, uuid[]) to authenticated;

-- One worker wins the row. A second worker gets no id and does not send.
create or replace function public.claim_transactional_sms(
  target_key text,
  target_profile uuid,
  target_job uuid,
  target_kind text,
  target_body text,
  target_phone text,
  target_status text,
  target_reason text,
  target_notification uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  if target_status not in ('queued', 'skipped') then
    raise exception 'status is not valid';
  end if;
  if coalesce(target_key, '') = '' then
    raise exception 'dedupe key required';
  end if;
  insert into public.transactional_sms (
    dedupe_key, notification_id, profile_id, job_id, kind, body, to_phone,
    status, skip_reason, claimed_at, attempt_count
  )
  values (
    target_key, target_notification, target_profile, target_job, left(target_kind, 80),
    left(target_body, 640),     target_phone, target_status, target_reason,
    case when target_status = 'queued' then now() else null end,
    case when target_status = 'queued' then 1 else 0 end
  )
  on conflict (dedupe_key) do nothing
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.claim_transactional_sms(text, uuid, uuid, text, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_transactional_sms(text, uuid, uuid, text, text, text, text, text, uuid)
  to service_role;

create or replace function public.finish_transactional_sms(
  target_key text,
  target_status text,
  target_sid text,
  target_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  if target_status not in ('accepted', 'failed', 'delivered', 'undelivered', 'retry', 'skipped') then
    raise exception 'status is not valid';
  end if;
  if target_status = 'skipped' then
    update public.transactional_sms
    set status = 'skipped',
        skip_reason = coalesce(nullif(target_error, ''), 'job_unavailable'),
        retryable = false,
        updated_at = now()
    where dedupe_key = target_key
      and provider_sid is null
      and status = 'queued';
    return;
  end if;
  if target_status = 'retry' then
    update public.transactional_sms
    set status = 'queued',
        claimed_at = null,
        send_started_at = null,
        retryable = true,
        error_code = coalesce(nullif(target_error, ''), error_code),
        updated_at = now()
    where dedupe_key = target_key
      and provider_sid is null
      and attempt_count < 2
      and status = 'queued';
    return;
  end if;
  update public.transactional_sms
  set status = case
        when status in ('delivered', 'undelivered', 'failed', 'skipped') then status
        else target_status
      end,
      provider_sid = coalesce(provider_sid, nullif(target_sid, '')),
      error_code = coalesce(error_code, nullif(target_error, '')),
      updated_at = now()
  where dedupe_key = target_key;
end;
$$;

revoke all on function public.finish_transactional_sms(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_transactional_sms(text, text, text, text) to service_role;

create or replace function public.record_transactional_delivery(
  provider_sid text,
  next_status text,
  error_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  if next_status not in ('accepted', 'delivered', 'undelivered', 'failed') then
    return;
  end if;
  update public.transactional_sms
  set status = case
        when status in ('delivered', 'undelivered', 'failed', 'skipped') then status
        when next_status = 'accepted' and status = 'delivered' then status
        else next_status
      end,
      error_code = coalesce(transactional_sms.error_code, nullif(record_transactional_delivery.error_code, '')),
      updated_at = now()
  where transactional_sms.provider_sid = record_transactional_delivery.provider_sid;
end;
$$;

revoke all on function public.record_transactional_delivery(text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_transactional_delivery(text, text, text) to service_role;

-- STOP must match a stored 11-digit number and a provider number that starts with +1.
-- The stored sign-in number is not rewritten.
create or replace function public.record_sms_opt_out(target_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
  digits text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  digits := regexp_replace(coalesce(target_phone, ''), '\D', '', 'g');
  if digits = '' then
    return;
  end if;
  select id into owner
  from auth.users
  where regexp_replace(coalesce(phone, ''), '\D', '', 'g') = digits
  limit 1;
  if owner is null then
    return;
  end if;
  update public.sms_consents
    set opted_out_at = now()
    where profile_id = owner
      and opted_out_at is null;
  insert into public.notification_preferences (profile_id, sms_enabled)
  values (owner, false)
  on conflict (profile_id) do update
    set sms_enabled = false,
        updated_at = now();
end;
$$;

revoke all on function public.record_sms_opt_out(text) from public, anon, authenticated;
grant execute on function public.record_sms_opt_out(text) to service_role;

-- START is the provider opt-in. A checkbox cannot clear a STOP by itself.
create or replace function public.record_sms_opt_in(target_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
  digits text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  digits := regexp_replace(coalesce(target_phone, ''), '\D', '', 'g');
  if digits = '' then
    return;
  end if;
  select id into owner
  from auth.users
  where regexp_replace(coalesce(phone, ''), '\D', '', 'g') = digits
  limit 1;
  if owner is null then
    return;
  end if;
  update public.sms_consents
    set opted_out_at = null
    where profile_id = owner
      and opted_out_at is not null;
  insert into public.notification_preferences (profile_id, sms_enabled)
  values (owner, true)
  on conflict (profile_id) do update
    set sms_enabled = true,
        updated_at = now();
end;
$$;

revoke all on function public.record_sms_opt_in(text) from public, anon, authenticated;
grant execute on function public.record_sms_opt_in(text) to service_role;

-- The in-app new-job alert uses one shared dedupe key per request, so it cannot
-- name every eligible driver. This list is the text audience.
create or replace function public.transactional_job_drivers(target_job uuid)
returns table (profile_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select d.profile_id
  from public.jobs j
  join public.drivers d on true
  join public.profiles p on p.id = d.profile_id
  where j.id = target_job
    and j.status = 'open'
    and d.status in ('approved_new', 'active')
    and not p.blocked
    and p.is_test = j.is_test
    and p.test_retired_at is null
    and public.coverage_matches(d.profile_id, j.pickup_area)
    and (d.is_online or d.offline_job_alerts)
    and not exists (
      select 1 from public.customer_driver_blocks b
      where b.customer_id = j.customer_id and b.driver_id = d.profile_id
    )
    and public.job_passes_filters(d.profile_id, j);
$$;

revoke all on function public.transactional_job_drivers(uuid) from public, anon, authenticated;
grant execute on function public.transactional_job_drivers(uuid) to service_role;

create index if not exists notifications_transactional_unchecked_idx
  on public.notifications (created_at)
  where transactional_checked_at is null;

-- One in-app alert per eligible driver. An existing new_job row is left alone,
-- so open requests do not get a second alert when this migration is applied.
create or replace function public.notify_drivers_of_open_job(job_row public.jobs)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  driver uuid;
  area text := left(coalesce(job_row.pickup_area, 'your area'), 80);
  waves boolean := public.waves_enabled();
begin
  if not public.quote_visible_to_drivers(job_row.pricing_method, job_row.driver_pay_cents, job_row.quote_expires_at) then
    return;
  end if;
  if job_row.test_retired_at is not null then
    return;
  end if;
  for driver in
    select d.profile_id
    from public.drivers d
    join public.profiles p on p.id = d.profile_id
    where d.status in ('approved_new', 'active')
      and not p.blocked
      and p.is_test = job_row.is_test
      and p.test_retired_at is null
      and public.coverage_matches(d.profile_id, job_row.pickup_area)
      and (d.is_online or d.offline_job_alerts)
      and not exists (
        select 1 from public.customer_driver_blocks b
        where b.customer_id = job_row.customer_id and b.driver_id = d.profile_id
      )
      and (not waves or public.job_released_to_driver(d.profile_id, job_row))
      and public.job_passes_filters(d.profile_id, job_row)
      and not exists (
        select 1 from public.notifications n
        where n.job_id = job_row.id
          and n.profile_id = d.profile_id
          and n.kind = 'new_job'
      )
  loop
    perform public.enqueue_notification(
      driver, job_row.id, 'new_job', 'New job nearby',
      'A new job is open in ' || area || '.',
      '/driver', 'new-job:' || job_row.id || ':' || driver
    );
  end loop;
end;
$$;

revoke all on function public.notify_drivers_of_open_job(public.jobs) from public, anon, authenticated, service_role;

-- The older status trigger alerted only the first online driver. Delegate to the per-driver function.
create or replace function public.notify_on_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  area text := left(coalesce(new.pickup_area, 'your area'), 80);
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
      perform public.notify_drivers_of_open_job(new);
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

-- Starting the trip is an explicit commitment. It does not change payment or status.
create or replace function public.note_trip_started()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'en_route'
    and old.status is distinct from 'en_route'
    and new.assigned_driver_id is not null
    and not exists (
      select 1 from public.job_events
      where job_id = new.id
        and type = 'driver_acknowledged'
        and actor_id = new.assigned_driver_id
    ) then
    begin
      insert into public.job_events (job_id, actor_id, type, data)
      values (new.id, new.assigned_driver_id, 'driver_acknowledged', jsonb_build_object('source', 'en_route'));
    exception when others then
      return new;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_note_trip_started on public.jobs;
create trigger jobs_note_trip_started
  after update of status on public.jobs
  for each row execute function public.note_trip_started();

revoke all on function public.note_trip_started() from public, anon, authenticated, service_role;

create or replace function public.mark_transactional_send_started(target_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  update public.transactional_sms
  set send_started_at = now(),
      updated_at = now()
  where dedupe_key = target_key
    and status = 'queued'
    and provider_sid is null;
end;
$$;

revoke all on function public.mark_transactional_send_started(text) from public, anon, authenticated;
grant execute on function public.mark_transactional_send_started(text) to service_role;

-- Retries only a queued row that never received a provider id.
-- A send that started and then disappeared is marked failed and is not sent again.
create or replace function public.reclaim_transactional_sms()
returns table (
  dedupe_key text,
  profile_id uuid,
  job_id uuid,
  kind text,
  body text,
  to_phone text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  update public.transactional_sms
  set status = 'failed',
      skip_reason = 'ambiguous_no_response',
      retryable = false,
      updated_at = now()
  where status = 'queued'
    and provider_sid is null
    and (
      (send_started_at is not null and send_started_at < now() - interval '2 minutes')
      or (send_started_at is null and attempt_count >= 2 and claimed_at < now() - interval '2 minutes')
    );

  return query
  with picked as (
    select id
    from public.transactional_sms
    where status = 'queued'
      and provider_sid is null
      and send_started_at is null
      and attempt_count < 2
      and (claimed_at is null or claimed_at < now() - interval '2 minutes')
      and (retryable or attempt_count >= 1)
    order by created_at
    limit 8
    for update skip locked
  )
  update public.transactional_sms as sms
  set claimed_at = now(),
      attempt_count = sms.attempt_count + 1,
      send_started_at = null,
      updated_at = now()
  from picked
  where sms.id = picked.id
  returning sms.dedupe_key, sms.profile_id, sms.job_id, sms.kind, sms.body, sms.to_phone, sms.attempt_count;
end;
$$;

revoke all on function public.reclaim_transactional_sms() from public, anon, authenticated;
grant execute on function public.reclaim_transactional_sms() to service_role;

alter table public.sms_consents drop constraint if exists sms_consents_source;
alter table public.sms_consents
  add constraint sms_consents_source
  check (source in ('login', 'driver_onboarding', 'profile'));

-- Explicit consent can turn texts on. It does not run unless the person checked the box.
create or replace function public.record_sms_consent(consent_source text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  if consent_source not in ('login', 'driver_onboarding', 'profile') then
    raise exception 'consent source is not valid';
  end if;
  insert into public.sms_consents (profile_id, disclosure_version, source, opted_out_at)
  values (
    auth.uid(),
    '2026-11-26',
    consent_source,
    (select max(opted_out_at) from public.sms_consents where profile_id = auth.uid())
  );
  insert into public.notification_preferences (profile_id, sms_enabled)
  values (auth.uid(), true)
  on conflict (profile_id) do update
    set sms_enabled = true,
        updated_at = now();
end;
$$;

revoke all on function public.record_sms_consent(text) from public, anon, service_role;
grant execute on function public.record_sms_consent(text) to authenticated;

drop function if exists public.save_notification_preferences(boolean, boolean, boolean);

create or replace function public.save_notification_preferences(
  push_on boolean,
  email_on boolean,
  promotional_on boolean default false,
  transactional_on boolean default null
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
  insert into public.notification_preferences (
    profile_id, push_enabled, email_enabled, sms_enabled, promotional_sms, promotional_sms_at, promotional_sms_source
  ) values (
    auth.uid(), coalesce(push_on, true), coalesce(email_on, true), coalesce(transactional_on, false),
    coalesce(promotional_on, false), now(), 'profile_notifications'
  )
  on conflict (profile_id) do update
    set push_enabled = excluded.push_enabled,
        email_enabled = excluded.email_enabled,
        sms_enabled = case
          when transactional_on is null then public.notification_preferences.sms_enabled
          else coalesce(transactional_on, false)
        end,
        promotional_sms = excluded.promotional_sms,
        promotional_sms_at = now(),
        promotional_sms_source = 'profile_notifications',
        updated_at = now();
  if transactional_on is true then
    insert into public.sms_consents (profile_id, disclosure_version, source, opted_out_at)
    values (
      auth.uid(),
      '2026-11-26',
      'profile',
      (select max(opted_out_at) from public.sms_consents where profile_id = auth.uid())
    );
  end if;
end;
$$;

revoke all on function public.save_notification_preferences(boolean, boolean, boolean, boolean) from public, anon, service_role;
grant execute on function public.save_notification_preferences(boolean, boolean, boolean, boolean) to authenticated;
