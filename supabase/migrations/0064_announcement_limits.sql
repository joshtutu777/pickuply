-- Daily bulk cap, per-person announcement cap, and two more audiences.
-- Local until applied. Does not send a real notification.

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
      drivers.license_url,
      drivers.insurance_url,
      drivers.training_completed_at,
      drivers.agreement_signed_at,
      coalesce((
        select count(*) from public.jobs
        where jobs.customer_id = profiles.id
          and jobs.status in ('assigned', 'en_route', 'arrived', 'item_check', 'in_transit', 'delivered')
      ), 0) as active_bookings,
      coalesce((
        select count(*) from public.jobs
        where jobs.customer_id = profiles.id
          and jobs.status in ('assigned', 'en_route', 'arrived', 'item_check', 'in_transit', 'delivered', 'completed')
      ), 0) as booked_jobs
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
      or (input.kind = 'never_booked' and people.role = 'customer' and people.booked_jobs = 0)
      or (
        input.kind = 'needs_documents'
        and people.driver_status is not null
        and people.driver_status <> 'removed'
        and people.driving_stopped_at is null
        and (
          people.license_url is null
          or people.insurance_url is null
          or people.training_completed_at is null
          or people.agreement_signed_at is null
        )
      )
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
  if send_kind in ('bulk', 'all_user') and (
    select count(*) from public.admin_announcements
    where created_by = actor and kind in ('bulk', 'all_user') and created_at > now() - interval '24 hours'
  ) >= 10 then
    raise exception 'That admin already sent 10 bulk announcements today.';
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
  recent integer;
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
      recent := 0;
      if item.purpose is distinct from 'account_support' then
        select count(*) into recent
        from public.admin_announcement_deliveries deliveries
        join public.admin_announcements sent on sent.id = deliveries.announcement_id
        where deliveries.profile_id = recipient.profile_id
          and sent.purpose = 'promotional'
          and deliveries.attempted_at > now() - interval '24 hours'
          and (
            deliveries.in_app = 'sent'
            or deliveries.push = 'provider_accepted'
            or deliveries.sms in ('mocked', 'sent')
          );
      end if;
      if recent >= 3 then
        insert into public.admin_announcement_deliveries (
          announcement_id, profile_id, push_devices, in_app, push, sms, push_displayed
        ) values (
          item.id, recipient.profile_id, 0, 'skipped', 'skipped', 'skipped', false
        )
        on conflict do nothing;
        continue;
      end if;
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
