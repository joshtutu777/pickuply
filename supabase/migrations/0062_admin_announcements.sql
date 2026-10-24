-- Admin announcements. Private conversations stay in the existing message tables.
-- Push is recorded as accepted by the provider. This migration does not display it.
-- SMS stays off unless platform_settings.sms_enabled is already on.

alter table public.notification_preferences
  add column if not exists promotional_sms boolean not null default false,
  add column if not exists promotional_sms_at timestamptz,
  add column if not exists promotional_sms_source text;

alter table public.push_subscriptions
  add column if not exists expired_at timestamptz;

create table public.admin_announcements (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id),
  title text not null,
  body text not null,
  href text not null,
  channels text[] not null,
  audience jsonb not null,
  purpose text not null,
  kind text not null,
  status text not null default 'scheduled',
  scheduled_for timestamptz not null,
  estimated_count integer not null,
  excluded_suspended integer not null default 0,
  eligible_count integer,
  started_at timestamptz,
  finished_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_announcements_copy check (char_length(title) between 1 and 120 and char_length(body) between 1 and 400),
  constraint admin_announcements_href check (href ~ '^/[^/]' or href = '/'),
  constraint admin_announcements_purpose check (purpose in ('promotional', 'account_support')),
  constraint admin_announcements_kind check (kind in ('immediate', 'bulk', 'all_user')),
  constraint admin_announcements_status check (status in ('scheduled', 'processing', 'sent', 'cancelled', 'failed'))
);

create table public.admin_announcement_deliveries (
  announcement_id uuid not null references public.admin_announcements (id),
  profile_id uuid not null references public.profiles (id),
  push_devices integer not null default 0,
  in_app text not null,
  push text not null,
  sms text not null,
  push_displayed boolean not null default false,
  sms_after timestamptz,
  attempted_at timestamptz not null default now(),
  primary key (announcement_id, profile_id)
);

alter table public.admin_announcements enable row level security;
alter table public.admin_announcement_deliveries enable row level security;

create policy admin_announcements_admin on public.admin_announcements
  for select to authenticated
  using (public.is_admin());

create policy admin_announcement_deliveries_admin on public.admin_announcement_deliveries
  for select to authenticated
  using (public.is_admin());

grant select on public.admin_announcements to authenticated;
grant select on public.admin_announcement_deliveries to authenticated;

create or replace function public.announcement_recipients(audience jsonb, purpose text)
returns table(profile_id uuid, suspended boolean)
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select
      coalesce(audience ->> 'kind', '') as kind,
      coalesce(audience ->> 'city', '') as city,
      coalesce((audience ->> 'onlineOnly')::boolean, false) as online_only,
      coalesce(array(select jsonb_array_elements_text(audience -> 'ids')), '{}') as ids
  ),
  people as (
    select
      profiles.id,
      profiles.role,
      profiles.deleted_at,
      public.account_is_suspended(profiles.id) as suspended,
      drivers.status as driver_status,
      drivers.driving_stopped_at,
      drivers.is_online,
      coalesce((
        select count(*) from public.jobs
        where jobs.customer_id = profiles.id
          and jobs.status in ('assigned', 'en_route', 'arrived', 'item_check', 'in_transit', 'delivered')
      ), 0) as active_bookings
    from public.profiles
    left join public.drivers on drivers.profile_id = profiles.id
  )
  select people.id, people.suspended
  from people
  cross join input
  where people.deleted_at is null
    and people.role is distinct from 'admin'
    and (
      (input.kind in ('individual', 'selected') and people.id::text = any (input.ids))
      or (input.kind = 'customers' and people.role = 'customer')
      or (input.kind = 'active_customers' and people.active_bookings > 0)
      or (
        input.kind in ('drivers', 'online_drivers', 'city_drivers', 'all')
        and (
          (input.kind = 'all' and people.role = 'customer')
          or (
            people.driver_status in ('active', 'approved_new')
            and people.driving_stopped_at is null
            and (input.kind <> 'online_drivers' or people.is_online)
            and (
              input.kind <> 'city_drivers'
              or (
                exists (
                  select 1
                  from public.driver_feed_filters filters
                  cross join lateral unnest(filters.cities) as covered(city)
                  where filters.profile_id = people.id
                    and lower(btrim(covered.city)) = lower(btrim(input.city))
                )
                and (not input.online_only or people.is_online)
              )
            )
            and input.kind <> 'all'
          )
          or (
            input.kind = 'all'
            and people.driver_status in ('active', 'approved_new')
            and people.driving_stopped_at is null
          )
        )
      )
    );
$$;

revoke all on function public.announcement_recipients(jsonb, text) from public, anon, authenticated, service_role;

create or replace function public.announcement_audience_preview(audience jsonb, purpose text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'eligible', count(*) filter (where not suspended or (purpose = 'account_support' and audience ->> 'kind' in ('individual', 'selected'))),
    'excludedSuspended', count(*) filter (where suspended and not (purpose = 'account_support' and audience ->> 'kind' in ('individual', 'selected')))
  )
  from public.announcement_recipients(audience, purpose);
$$;

revoke all on function public.announcement_audience_preview(jsonb, text) from public, anon;
grant execute on function public.announcement_audience_preview(jsonb, text) to authenticated, service_role;

create or replace function public.create_admin_announcement(
  p_title text,
  p_body text,
  p_href text,
  p_channels text[],
  p_audience jsonb,
  p_purpose text,
  p_scheduled_for timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  preview jsonb;
  eligible integer;
  send_at timestamptz := coalesce(p_scheduled_for, now());
  send_kind text;
  announcement_id uuid;
begin
  if not public.is_admin() then
    raise exception 'only an admin can send an announcement';
  end if;
  if p_purpose not in ('promotional', 'account_support') then
    raise exception 'choose promotional or account support';
  end if;
  if p_href is null or p_href !~ '^/' or p_href ~ '^//' then
    raise exception 'choose a page inside Pickuply';
  end if;
  if p_channels is null or not p_channels <@ array['in_app', 'push', 'sms'] or cardinality(p_channels) = 0 then
    raise exception 'choose at least one channel';
  end if;
  if send_at > now() + interval '30 days' then
    raise exception 'Schedule no more than 30 days ahead.';
  end if;
  if send_at < now() - interval '5 seconds' then
    raise exception 'A scheduled announcement cannot go out before its time.';
  end if;
  perform pg_advisory_xact_lock(hashtext(actor::text));
  preview := public.announcement_audience_preview(p_audience, p_purpose);
  eligible := coalesce((preview ->> 'eligible')::integer, 0);
  if eligible > 1000 then
    raise exception 'This audience is over 1,000 people. Narrow it before sending. Nobody was left off silently.';
  end if;
  if (
    select count(*) from public.admin_announcements
    where created_by = actor and status = 'scheduled' and started_at is null
  ) >= 20 then
    raise exception 'You already have 20 announcements waiting.';
  end if;
  send_kind := case
    when p_audience ->> 'kind' = 'all' then 'all_user'
    when p_audience ->> 'kind' = 'individual' and send_at <= now() + interval '1 minute' then 'immediate'
    else 'bulk'
  end;
  if send_kind = 'immediate' and (
    select count(*) from public.admin_announcements
    where created_by = actor and kind = 'immediate' and created_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception 'That admin already sent 20 immediate announcements this hour.';
  end if;
  if send_kind in ('bulk', 'all_user') and (
    select count(*) from public.admin_announcements
    where created_by = actor and kind in ('bulk', 'all_user') and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'That admin already sent 5 bulk announcements this hour.';
  end if;
  if send_kind = 'all_user' and (
    select count(*) from public.admin_announcements
    where created_by = actor and kind = 'all_user' and created_at > now() - interval '24 hours'
  ) >= 2 then
    raise exception 'That admin already sent 2 all-user announcements today.';
  end if;
  insert into public.admin_announcements (
    created_by, title, body, href, channels, audience, purpose, kind, scheduled_for, estimated_count, excluded_suspended
  ) values (
    actor, btrim(p_title), btrim(p_body), p_href, p_channels, p_audience, p_purpose, send_kind, send_at,
    eligible, coalesce((preview ->> 'excludedSuspended')::integer, 0)
  ) returning id into announcement_id;
  return announcement_id;
end;
$$;

revoke all on function public.create_admin_announcement(text, text, text, text[], jsonb, text, timestamptz) from public, anon, service_role;
grant execute on function public.create_admin_announcement(text, text, text, text[], jsonb, text, timestamptz) to authenticated;

create or replace function public.cancel_admin_announcement(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can cancel an announcement';
  end if;
  update public.admin_announcements
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = target and status = 'scheduled' and started_at is null;
  if not found then
    raise exception 'this announcement has already started';
  end if;
end;
$$;

revoke all on function public.cancel_admin_announcement(uuid) from public, anon, service_role;
grant execute on function public.cancel_admin_announcement(uuid) to authenticated;

create or replace function public.update_admin_announcement(
  target uuid,
  p_title text,
  p_body text,
  p_scheduled_for timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can edit an announcement';
  end if;
  if p_scheduled_for > now() + interval '30 days' or p_scheduled_for < now() - interval '5 seconds' then
    raise exception 'Schedule no more than 30 days ahead.';
  end if;
  update public.admin_announcements
  set title = btrim(p_title), body = btrim(p_body), scheduled_for = p_scheduled_for, updated_at = now()
  where id = target and status = 'scheduled' and started_at is null;
  if not found then
    raise exception 'this announcement has already started';
  end if;
end;
$$;

revoke all on function public.update_admin_announcement(uuid, text, text, timestamptz) from public, anon, service_role;
grant execute on function public.update_admin_announcement(uuid, text, text, timestamptz) to authenticated;

create or replace function public.announcement_sms_state(target uuid, purpose text, send_at timestamptz)
returns table(state text, send_after timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sms_on boolean;
  local_time timestamp;
  hour integer;
  opted_out boolean;
  consented boolean;
begin
  select sms_enabled into sms_on from public.platform_settings where id = 1;
  if coalesce(sms_on, false) = false then
    state := 'skipped';
    return next;
    return;
  end if;
  select exists (
    select 1 from public.sms_consents
    where profile_id = target and opted_out_at is not null
  ) into opted_out;
  select coalesce(promotional_sms, false) into consented
  from public.notification_preferences where profile_id = target;
  if opted_out or (purpose = 'promotional' and not coalesce(consented, false)) then
    state := 'skipped';
    return next;
    return;
  end if;
  local_time := timezone('America/New_York', send_at);
  hour := extract(hour from local_time);
  if hour >= 8 and hour < 21 then
    state := 'mocked';
    return next;
    return;
  end if;
  state := 'deferred';
  if hour < 8 then
    send_after := (date_trunc('day', local_time) + interval '8 hours') at time zone 'America/New_York';
  else
    send_after := (date_trunc('day', local_time) + interval '1 day 8 hours') at time zone 'America/New_York';
  end if;
  return next;
end;
$$;

revoke all on function public.announcement_sms_state(uuid, text, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.execute_due_announcements()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.admin_announcements%rowtype;
  recipient record;
  preview jsonb;
  eligible integer;
      devices integer;
      handled integer := 0;
      sms_state text;
      sms_after timestamptz;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not public.is_migration_session() then
    raise exception 'service role required';
  end if;
  for item in
    select * from public.admin_announcements
    where status = 'scheduled' and started_at is null and scheduled_for <= now()
    order by scheduled_for, id
    for update skip locked
  loop
    update public.admin_announcements set status = 'processing', started_at = now(), updated_at = now() where id = item.id;
    preview := public.announcement_audience_preview(item.audience, item.purpose);
    eligible := coalesce((preview ->> 'eligible')::integer, 0);
    update public.admin_announcements
    set eligible_count = eligible, excluded_suspended = coalesce((preview ->> 'excludedSuspended')::integer, 0)
    where id = item.id;
    for recipient in
      select people.profile_id
      from public.announcement_recipients(item.audience, item.purpose) people
      where not people.suspended
        or (item.purpose = 'account_support' and item.audience ->> 'kind' in ('individual', 'selected'))
    loop
      select count(*) into devices
      from public.push_subscriptions
      where profile_id = recipient.profile_id
        and expired_at is null
        and not exists (
          select 1 from public.notification_preferences prefs
          where prefs.profile_id = recipient.profile_id and prefs.push_enabled = false
        );
      sms_state := 'skipped';
      sms_after := null;
      if 'sms' = any (item.channels) then
        select state, send_after into sms_state, sms_after
        from public.announcement_sms_state(recipient.profile_id, item.purpose, now());
      end if;
      insert into public.admin_announcement_deliveries (
        announcement_id, profile_id, push_devices, in_app, push, sms, push_displayed, sms_after
      ) values (
        item.id,
        recipient.profile_id,
        case when 'push' = any (item.channels) and devices > 0 then devices else 0 end,
        case when 'in_app' = any (item.channels) then 'sent' else 'skipped' end,
        case when 'push' = any (item.channels) and devices > 0 then 'provider_accepted' else 'skipped' end,
        coalesce(sms_state, 'skipped'),
        false,
        sms_after
      )
      on conflict do nothing;
      if 'in_app' = any (item.channels) then
        insert into public.notifications (profile_id, kind, title, body, href, dedupe_key)
        values (recipient.profile_id, 'admin_announcement', item.title, item.body, item.href, 'announcement:' || item.id::text)
        on conflict (profile_id, dedupe_key) do nothing;
      end if;
    end loop;
    update public.admin_announcements
    set status = 'sent', finished_at = now(), updated_at = now()
    where id = item.id;
    handled := handled + 1;
  end loop;
  return handled;
end;
$$;

revoke all on function public.execute_due_announcements() from public, anon, authenticated;
grant execute on function public.execute_due_announcements() to service_role;

drop function if exists public.save_notification_preferences(boolean, boolean);

create or replace function public.save_notification_preferences(
  push_on boolean,
  email_on boolean,
  promotional_on boolean default false
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
    auth.uid(), coalesce(push_on, true), coalesce(email_on, true), false,
    coalesce(promotional_on, false), now(), 'profile_notifications'
  )
  on conflict (profile_id) do update
    set push_enabled = excluded.push_enabled,
        email_enabled = excluded.email_enabled,
        promotional_sms = excluded.promotional_sms,
        promotional_sms_at = now(),
        promotional_sms_source = 'profile_notifications',
        updated_at = now();
end;
$$;

revoke all on function public.save_notification_preferences(boolean, boolean, boolean) from public, anon, service_role;
grant execute on function public.save_notification_preferences(boolean, boolean, boolean) to authenticated;
