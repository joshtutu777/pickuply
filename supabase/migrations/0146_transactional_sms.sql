-- Transactional booking texts. Not applied. Sending stays off until
-- transactional_sms_enabled_at is set by an admin.

alter table public.platform_settings
  add column if not exists admin_alert_phone text,
  add column if not exists driver_job_sms_audience text not null default 'eligible',
  add column if not exists transactional_sms_enabled_at timestamptz;

alter table public.platform_settings
  drop constraint if exists platform_settings_admin_alert_phone_e164,
  drop constraint if exists platform_settings_driver_job_sms_audience_check;

alter table public.platform_settings
  add constraint platform_settings_admin_alert_phone_e164
    check (admin_alert_phone is null or admin_alert_phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  add constraint platform_settings_driver_job_sms_audience_check
    check (driver_job_sms_audience in ('eligible', 'online', 'off'));

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
  turn_on boolean
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
  set admin_alert_phone = cleaned,
      driver_job_sms_audience = audience,
      transactional_sms_enabled_at = case
        when coalesce(turn_on, false) then coalesce(transactional_sms_enabled_at, now())
        else null
      end,
      updated_at = now()
  where id = 1;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'set_transactional_alerts',
    'platform_settings',
    null,
    jsonb_build_object(
      'audience', audience,
      'enabled', coalesce(turn_on, false),
      'phone_set', cleaned is not null
    )
  );
end;
$$;

revoke all on function public.set_transactional_alerts(text, text, boolean) from public, anon, service_role;
grant execute on function public.set_transactional_alerts(text, text, boolean) to authenticated;

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
    status, skip_reason, claimed_at
  )
  values (
    target_key, target_notification, target_profile, target_job, left(target_kind, 80),
    left(target_body, 640), target_phone, target_status, target_reason,
    case when target_status = 'queued' then now() else null end
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
  if target_status not in ('accepted', 'failed', 'delivered', 'undelivered') then
    raise exception 'status is not valid';
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
