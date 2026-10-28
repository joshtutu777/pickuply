-- SMS campaigns reuse consent, STOP, quiet hours, and the announcement send caps.
-- Texting stays off unless platform_settings.sms_enabled is already on.
-- This does not call Twilio.

create or replace function public.sms_phone_key(value text)
returns text
language sql
immutable
as $$
  select case
    when digits ~ '^1[0-9]{10}$' then right(digits, 10)
    when digits ~ '^[0-9]{10}$' then digits
    else null
  end
  from (select regexp_replace(coalesce(value, ''), '\D', '', 'g') as digits) cleaned;
$$;

create or replace function public.sms_first_name(full_name text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(split_part(btrim(coalesce(full_name, '')), ' ', 1), ''), 'there');
$$;

create or replace function public.sms_campaign_text(message_body text, person_name text, purpose text)
returns text
language sql
immutable
as $$
  select case
    when purpose = 'promotional' and position('reply stop' in lower(prefixed)) = 0
      then prefixed || ' Reply STOP to opt out.'
    else prefixed
  end
  from (
    select case
      when lower(named) like 'pickuply:%' then named
      else 'Pickuply: ' || named
    end as prefixed
    from (
      select replace(btrim(coalesce(message_body, '')), '{{first_name}}', public.sms_first_name(person_name)) as named
    ) named_body
  ) prefixed_body;
$$;

revoke all on function public.sms_phone_key(text) from public, anon, authenticated;
revoke all on function public.sms_first_name(text) from public, anon, authenticated;
revoke all on function public.sms_campaign_text(text, text, text) from public, anon, authenticated;

create table public.sms_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id),
  name text not null,
  body text not null,
  audience jsonb not null,
  purpose text not null,
  kind text not null,
  status text not null default 'draft',
  scheduled_for timestamptz,
  queued_at timestamptz,
  audience_preview jsonb not null default '{}'::jsonb,
  estimated_phones integer not null default 0,
  eligible_phones integer,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  paused_at timestamptz,
  constraint sms_campaigns_purpose check (purpose in ('promotional', 'account_support')),
  constraint sms_campaigns_kind check (kind in ('immediate', 'bulk', 'all_user')),
  constraint sms_campaigns_status check (status in ('draft', 'scheduled', 'paused', 'sending', 'sent', 'cancelled', 'failed')),
  constraint sms_campaigns_name check (char_length(btrim(name)) between 1 and 80),
  constraint sms_campaigns_body check (char_length(btrim(body)) between 1 and 320)
);

create index sms_campaigns_due_idx on public.sms_campaigns (scheduled_for, id)
  where status = 'scheduled';

create table public.sms_campaign_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.sms_campaigns (id) on delete cascade,
  profile_id uuid not null references public.profiles (id),
  phone_key text not null,
  first_name text not null,
  body text not null,
  segments integer not null,
  status text not null,
  reason text,
  send_after timestamptz,
  created_at timestamptz not null default now(),
  constraint sms_campaign_deliveries_status check (status in ('skipped', 'deferred', 'mocked', 'sent', 'failed')),
  constraint sms_campaign_deliveries_phone check (phone_key ~ '^[0-9]{10}$'),
  unique (campaign_id, phone_key)
);

create index sms_campaign_deliveries_profile_idx on public.sms_campaign_deliveries (profile_id, created_at);

alter table public.sms_campaigns enable row level security;
alter table public.sms_campaign_deliveries enable row level security;

create policy sms_campaigns_admin_select on public.sms_campaigns
  for select to authenticated
  using (public.is_admin());

revoke all on public.sms_campaigns from public, anon, authenticated;
revoke all on public.sms_campaign_deliveries from public, anon, authenticated;
grant select on public.sms_campaigns to authenticated;

create or replace function public.stamp_sms_campaign_lane()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.is_test := public.actor_is_test();
  return new;
end;
$$;

revoke all on function public.stamp_sms_campaign_lane() from public, anon, authenticated, service_role;

drop trigger if exists sms_campaigns_stamp_lane on public.sms_campaigns;
create trigger sms_campaigns_stamp_lane
  before insert on public.sms_campaigns
  for each row execute function public.stamp_sms_campaign_lane();

create or replace function public.sms_campaign_check_audience(audience jsonb)
returns void
language plpgsql
as $$
declare
  kind text := coalesce(audience ->> 'kind', '');
  item text;
  total integer;
begin
  if kind not in ('individual', 'selected', 'drivers', 'customers', 'both') then
    raise exception 'Choose who should receive this text.';
  end if;
  if audience ? 'ids' and jsonb_typeof(audience -> 'ids') is distinct from 'array' then
    raise exception 'Choose the people by their ids.';
  end if;
  if audience ? 'zips' and jsonb_typeof(audience -> 'zips') is distinct from 'array' then
    raise exception 'Use 5-digit ZIP codes.';
  end if;
  if audience ? 'cities' and jsonb_typeof(audience -> 'cities') is distinct from 'array' then
    raise exception 'Check the city names.';
  end if;
  if audience ? 'states' and jsonb_typeof(audience -> 'states') is distinct from 'array' then
    raise exception 'Use a two-letter state, such as GA.';
  end if;
  total := coalesce(jsonb_array_length(audience -> 'ids'), 0);
  if kind = 'individual' and total <> 1 then
    raise exception 'One person needs exactly one id.';
  end if;
  if kind = 'selected' and total < 1 then
    raise exception 'Choose at least one person.';
  end if;
  if total > 50 then
    raise exception 'Choose 50 people or fewer, or use a group.';
  end if;
  for item in select jsonb_array_elements_text(coalesce(audience -> 'ids', '[]'::jsonb)) loop
    if item !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'A person id is not valid.';
    end if;
  end loop;
  total := coalesce(jsonb_array_length(audience -> 'zips'), 0);
  if total > 30 then
    raise exception 'Use 30 ZIP codes or fewer.';
  end if;
  for item in select jsonb_array_elements_text(coalesce(audience -> 'zips', '[]'::jsonb)) loop
    if item !~ '^[0-9]{5}$' then
      raise exception 'Use 5-digit ZIP codes.';
    end if;
  end loop;
  total := coalesce(jsonb_array_length(audience -> 'cities'), 0);
  if total > 20 then
    raise exception 'Use 20 cities or fewer.';
  end if;
  for item in select jsonb_array_elements_text(coalesce(audience -> 'cities', '[]'::jsonb)) loop
    if char_length(btrim(item)) < 2 or char_length(btrim(item)) > 40 then
      raise exception 'Check the city names.';
    end if;
  end loop;
  total := coalesce(jsonb_array_length(audience -> 'states'), 0);
  if total > 10 then
    raise exception 'Use 10 states or fewer.';
  end if;
  for item in select jsonb_array_elements_text(coalesce(audience -> 'states', '[]'::jsonb)) loop
    if upper(btrim(item)) !~ '^[A-Z]{2}$' then
      raise exception 'Use a two-letter state, such as GA.';
    end if;
  end loop;
end;
$$;

revoke all on function public.sms_campaign_check_audience(jsonb) from public, anon, authenticated, service_role;

create or replace function public.sms_campaign_candidates(audience jsonb, purpose text)
returns table(profile_id uuid, phone_key text, first_name text, skip_reason text)
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select
      coalesce(audience ->> 'kind', '') as kind,
      coalesce(array(select jsonb_array_elements_text(coalesce(audience -> 'ids', '[]'::jsonb))), '{}'::text[]) as ids,
      coalesce(array(select jsonb_array_elements_text(coalesce(audience -> 'zips', '[]'::jsonb))), '{}'::text[]) as zips,
      coalesce(array(select lower(btrim(value)) from jsonb_array_elements_text(coalesce(audience -> 'cities', '[]'::jsonb)) as value), '{}'::text[]) as cities,
      coalesce(array(select upper(btrim(value)) from jsonb_array_elements_text(coalesce(audience -> 'states', '[]'::jsonb)) as value), '{}'::text[]) as states
  ),
  located as (
    select profile_id, nullif(lower(btrim(city)), '') as city, zip, state
    from (
      select
        source.profile_id,
        source.city,
        case when source.zip ~ '^[0-9]{5}$' then source.zip else null end as zip
      from (
        select drivers.profile_id, drivers.home_city as city, drivers.home_zip as zip from public.drivers
        union all
        select driver_places.profile_id, driver_places.city, driver_places.zip from public.driver_places
        union all
        select filters.profile_id, covered.city, null
        from public.driver_feed_filters filters
        cross join lateral unnest(filters.cities) as covered(city)
        union all
        select filters.profile_id, null, covered.zip
        from public.driver_feed_filters filters
        cross join lateral unnest(filters.zips) as covered(zip)
        union all
        select customer_places.customer_id, customer_places.city, customer_places.zip from public.customer_places
      ) source
    ) cleaned
    cross join lateral (
      select case
        when cleaned.city is not null or cleaned.zip is not null then 'GA'
        else null
      end as state
    ) region
    where cleaned.city is not null or cleaned.zip is not null
  ),
  matched as (
    select
      profiles.id,
      profiles.created_at,
      public.sms_first_name(profiles.full_name) as first_name,
      public.account_is_suspended(profiles.id) as suspended,
      users.phone,
      users.phone_confirmed_at,
      public.sms_phone_key(users.phone) as phone_key,
      exists (
        select 1 from public.sms_consents consents
        where consents.profile_id = profiles.id and consents.opted_out_at is not null
      ) as opted_out,
      coalesce(prefs.promotional_sms, false) as marketing
    from public.profiles
    join auth.users users on users.id = profiles.id
    left join public.drivers on drivers.profile_id = profiles.id
    left join public.notification_preferences prefs on prefs.profile_id = profiles.id
    cross join input
    where profiles.deleted_at is null
      and profiles.test_retired_at is null
      and profiles.role is distinct from 'admin'
      and profiles.is_test = case
        when current_setting('pickuply.announcement_test_lane', true) in ('true', 'false')
          then current_setting('pickuply.announcement_test_lane', true)::boolean
        else public.actor_is_test()
      end
      and (
        (input.kind in ('individual', 'selected') and profiles.id::text = any (input.ids))
        or (input.kind = 'customers' and profiles.role = 'customer')
        or (
          input.kind in ('drivers', 'both')
          and drivers.status in ('active', 'approved_new')
          and drivers.driving_stopped_at is null
        )
        or (input.kind = 'both' and profiles.role = 'customer')
      )
      and (
        coalesce(cardinality(input.zips), 0) = 0
        or exists (
          select 1 from located
          where located.profile_id = profiles.id and located.zip = any (input.zips)
        )
      )
      and (
        coalesce(cardinality(input.cities), 0) = 0
        or exists (
          select 1 from located
          where located.profile_id = profiles.id and located.city = any (input.cities)
        )
      )
      and (
        coalesce(cardinality(input.states), 0) = 0
        or exists (
          select 1 from located
          where located.profile_id = profiles.id and located.state = any (input.states)
        )
      )
  ),
  classified as (
    select
      matched.id,
      matched.created_at,
      matched.first_name,
      matched.phone_key,
      case
        when matched.suspended and not (purpose = 'account_support' and audience ->> 'kind' in ('individual', 'selected')) then 'suspended'
        when matched.phone is null or btrim(matched.phone) = '' then 'no_phone'
        when matched.phone_confirmed_at is null or matched.phone_key is null then 'unverified'
        when matched.opted_out then 'opted_out'
        when not matched.marketing then 'no_marketing_consent'
        else null
      end as base_reason
    from matched
  )
  select
    classified.id,
    classified.phone_key,
    classified.first_name,
    case
      when classified.base_reason is not null then classified.base_reason
      when row_number() over (
        partition by case when classified.base_reason is null then classified.phone_key else classified.id::text end
        order by classified.created_at, classified.id
      ) > 1 then 'duplicate'
      else null
    end as skip_reason
  from classified;
$$;

revoke all on function public.sms_campaign_candidates(jsonb, text) from public, anon, authenticated, service_role;

create or replace function public.sms_campaign_preview(audience jsonb, purpose text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can preview a text campaign';
  end if;
  if purpose not in ('promotional', 'account_support') then
    raise exception 'Choose promotional or account support.';
  end if;
  perform public.sms_campaign_check_audience(audience);
  return (
    select jsonb_build_object(
      'phones', count(*) filter (where skip_reason is null),
      'duplicatesRemoved', count(*) filter (where skip_reason = 'duplicate'),
      'ineligible', count(*) filter (where skip_reason is not null and skip_reason <> 'duplicate'),
      'unverified', count(*) filter (where skip_reason = 'unverified'),
      'optedOut', count(*) filter (where skip_reason = 'opted_out'),
      'noMarketingConsent', count(*) filter (where skip_reason = 'no_marketing_consent'),
      'noPhone', count(*) filter (where skip_reason = 'no_phone'),
      'suspended', count(*) filter (where skip_reason = 'suspended')
    )
    from public.sms_campaign_candidates(audience, purpose)
  );
end;
$$;

revoke all on function public.sms_campaign_preview(jsonb, text) from public, anon;
grant execute on function public.sms_campaign_preview(jsonb, text) to authenticated;

create or replace function public.sms_campaign_kind(audience jsonb, send_at timestamptz)
returns text
language sql
stable
as $$
  select case
    when audience ->> 'kind' = 'both' then 'all_user'
    when audience ->> 'kind' = 'individual' and send_at <= now() + interval '1 minute' then 'immediate'
    else 'bulk'
  end;
$$;

revoke all on function public.sms_campaign_kind(jsonb, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.sms_campaign_enforce_limits(actor uuid, send_kind text, phones integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  waiting integer;
  recent integer;
begin
  if phones > 1000 then
    raise exception 'This audience is over 1,000 people. Narrow it before sending. Nobody was left off silently.';
  end if;
  select
    (select count(*) from public.admin_announcements
      where created_by = actor and status = 'scheduled' and started_at is null)
    + (select count(*) from public.sms_campaigns
      where created_by = actor and status = 'scheduled')
  into waiting;
  if waiting >= 20 then
    raise exception 'You already have 20 announcements waiting.';
  end if;
  if send_kind = 'immediate' then
    select
      (select count(*) from public.admin_announcements
        where created_by = actor and kind = 'immediate' and created_at > now() - interval '1 hour')
      + (select count(*) from public.sms_campaigns
        where created_by = actor and kind = 'immediate' and queued_at > now() - interval '1 hour')
    into recent;
    if recent >= 20 then
      raise exception 'That admin already sent 20 immediate announcements this hour.';
    end if;
  end if;
  if send_kind in ('bulk', 'all_user') then
    select
      (select count(*) from public.admin_announcements
        where created_by = actor and kind in ('bulk', 'all_user') and created_at > now() - interval '1 hour')
      + (select count(*) from public.sms_campaigns
        where created_by = actor and kind in ('bulk', 'all_user') and queued_at > now() - interval '1 hour')
    into recent;
    if recent >= 5 then
      raise exception 'That admin already sent 5 bulk announcements this hour.';
    end if;
    select
      (select count(*) from public.admin_announcements
        where created_by = actor and kind in ('bulk', 'all_user') and created_at > now() - interval '24 hours')
      + (select count(*) from public.sms_campaigns
        where created_by = actor and kind in ('bulk', 'all_user') and queued_at > now() - interval '24 hours')
    into recent;
    if recent >= 10 then
      raise exception 'That admin already sent 10 bulk announcements today.';
    end if;
  end if;
  if send_kind = 'all_user' then
    select
      (select count(*) from public.admin_announcements
        where created_by = actor and kind = 'all_user' and created_at > now() - interval '24 hours')
      + (select count(*) from public.sms_campaigns
        where created_by = actor and kind = 'all_user' and queued_at > now() - interval '24 hours')
    into recent;
    if recent >= 2 then
      raise exception 'That admin already sent 2 all-user announcements today.';
    end if;
  end if;
end;
$$;

revoke all on function public.sms_campaign_enforce_limits(uuid, text, integer) from public, anon, authenticated, service_role;

create or replace function public.save_sms_campaign(
  target uuid,
  p_name text,
  p_body text,
  p_audience jsonb,
  p_purpose text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  campaign_id uuid := target;
  preview jsonb;
begin
  if not public.is_admin() then
    raise exception 'only an admin can save a text campaign';
  end if;
  if p_purpose not in ('promotional', 'account_support') then
    raise exception 'Choose promotional or account support.';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'Name this campaign in 80 characters or fewer.';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 320 then
    raise exception 'Write a message of 320 characters or fewer.';
  end if;
  perform public.sms_campaign_check_audience(p_audience);
  preview := public.sms_campaign_preview(p_audience, p_purpose);
  if target is null then
    insert into public.sms_campaigns (
      created_by, name, body, audience, purpose, kind, status, audience_preview, estimated_phones
    ) values (
      actor, btrim(p_name), btrim(p_body), p_audience, p_purpose, 'bulk', 'draft', preview,
      coalesce((preview ->> 'phones')::integer, 0)
    ) returning id into campaign_id;
  else
    update public.sms_campaigns
    set name = btrim(p_name),
        body = btrim(p_body),
        audience = p_audience,
        purpose = p_purpose,
        audience_preview = preview,
        estimated_phones = coalesce((preview ->> 'phones')::integer, 0),
        updated_at = now()
    where id = target and status = 'draft' and created_by = actor
    returning id into campaign_id;
    if campaign_id is null then
      raise exception 'Only a draft can be edited.';
    end if;
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (actor, 'sms_campaign_draft', 'sms_campaign', campaign_id, jsonb_build_object(
    'purpose', p_purpose,
    'kind', p_audience ->> 'kind',
    'phones', coalesce((preview ->> 'phones')::integer, 0)
  ));
  return campaign_id;
end;
$$;

revoke all on function public.save_sms_campaign(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.save_sms_campaign(uuid, text, text, jsonb, text) to authenticated;

create or replace function public.schedule_sms_campaign(target uuid, p_scheduled_for timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  item public.sms_campaigns%rowtype;
  send_at timestamptz := coalesce(p_scheduled_for, now());
  send_kind text;
  preview jsonb;
  phones integer;
begin
  if not public.is_admin() then
    raise exception 'only an admin can schedule a text campaign';
  end if;
  if send_at > now() + interval '30 days' then
    raise exception 'Schedule no more than 30 days ahead.';
  end if;
  if send_at < now() - interval '5 seconds' then
    raise exception 'A scheduled text cannot go out before its time.';
  end if;
  select * into item from public.sms_campaigns where id = target and created_by = actor for update;
  if not found or item.status not in ('draft', 'paused') then
    raise exception 'Only a draft or a paused campaign can be scheduled.';
  end if;
  perform public.sms_campaign_check_audience(item.audience);
  preview := public.sms_campaign_preview(item.audience, item.purpose);
  phones := coalesce((preview ->> 'phones')::integer, 0);
  send_kind := public.sms_campaign_kind(item.audience, send_at);
  perform pg_advisory_xact_lock(hashtext(actor::text));
  perform public.sms_campaign_enforce_limits(actor, send_kind, phones);
  update public.sms_campaigns
  set status = 'scheduled',
      kind = send_kind,
      scheduled_for = send_at,
      queued_at = coalesce(queued_at, now()),
      audience_preview = preview,
      estimated_phones = phones,
      paused_at = null,
      updated_at = now()
  where id = target;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (actor, 'sms_campaign_scheduled', 'sms_campaign', target, jsonb_build_object(
    'phones', phones,
    'scheduled_for', send_at
  ));
end;
$$;

revoke all on function public.schedule_sms_campaign(uuid, timestamptz) from public, anon;
grant execute on function public.schedule_sms_campaign(uuid, timestamptz) to authenticated;

create or replace function public.pause_sms_campaign(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'only an admin can pause a text campaign';
  end if;
  update public.sms_campaigns
  set status = 'paused', paused_at = now(), updated_at = now()
  where id = target and created_by = actor and status in ('scheduled', 'sending');
  if not found then
    raise exception 'Only a scheduled campaign can be paused.';
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (actor, 'sms_campaign_paused', 'sms_campaign', target, '{}'::jsonb);
end;
$$;

revoke all on function public.pause_sms_campaign(uuid) from public, anon;
grant execute on function public.pause_sms_campaign(uuid) to authenticated;

create or replace function public.cancel_sms_campaign(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'only an admin can cancel a text campaign';
  end if;
  update public.sms_campaigns
  set status = 'cancelled', updated_at = now()
  where id = target and created_by = actor and status in ('draft', 'scheduled', 'paused');
  if not found then
    raise exception 'This campaign can no longer be cancelled.';
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (actor, 'sms_campaign_cancelled', 'sms_campaign', target, '{}'::jsonb);
end;
$$;

revoke all on function public.cancel_sms_campaign(uuid) from public, anon;
grant execute on function public.cancel_sms_campaign(uuid) to authenticated;

create or replace function public.sms_campaign_delivery_rows(target uuid)
returns table(first_name text, phone_last4 text, status text, reason text, segments integer, send_after timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select deliveries.first_name, right(deliveries.phone_key, 4), deliveries.status, deliveries.reason, deliveries.segments, deliveries.send_after
  from public.sms_campaign_deliveries deliveries
  where deliveries.campaign_id = target
    and public.is_admin()
  order by deliveries.created_at, deliveries.first_name;
$$;

revoke all on function public.sms_campaign_delivery_rows(uuid) from public, anon;
grant execute on function public.sms_campaign_delivery_rows(uuid) to authenticated;

create or replace function public.execute_due_sms_campaigns()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.sms_campaigns%rowtype;
  person record;
  preview jsonb;
  phones integer;
  handled integer := 0;
  recent integer;
  sms_state text;
  sms_after timestamptz;
  rendered text;
  current_status text;
  consent_reason text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not public.is_migration_session() then
    raise exception 'service role required';
  end if;
  for item in
    select * from public.sms_campaigns
    where status = 'scheduled' and scheduled_for is not null and scheduled_for <= now()
    order by scheduled_for, id
    for update skip locked
  loop
    update public.sms_campaigns
    set status = 'sending', started_at = coalesce(started_at, now()), updated_at = now()
    where id = item.id;
    perform set_config('pickuply.announcement_test_lane', item.is_test::text, true);
    preview := (
      select jsonb_build_object(
        'phones', count(*) filter (where skip_reason is null),
        'duplicatesRemoved', count(*) filter (where skip_reason = 'duplicate'),
        'ineligible', count(*) filter (where skip_reason is not null and skip_reason <> 'duplicate'),
        'unverified', count(*) filter (where skip_reason = 'unverified'),
        'optedOut', count(*) filter (where skip_reason = 'opted_out'),
        'noMarketingConsent', count(*) filter (where skip_reason = 'no_marketing_consent'),
        'noPhone', count(*) filter (where skip_reason = 'no_phone'),
        'suspended', count(*) filter (where skip_reason = 'suspended')
      )
      from public.sms_campaign_candidates(item.audience, item.purpose)
    );
    phones := coalesce((preview ->> 'phones')::integer, 0);
    update public.sms_campaigns
    set audience_preview = preview, eligible_phones = phones, updated_at = now()
    where id = item.id;
    if phones > 1000 then
      update public.sms_campaigns
      set status = 'failed', finished_at = now(), updated_at = now()
      where id = item.id;
      handled := handled + 1;
      continue;
    end if;
    for person in
      select profile_id, phone_key, first_name
      from public.sms_campaign_candidates(item.audience, item.purpose) people
      where people.skip_reason is null
        and not exists (
          select 1 from public.sms_campaign_deliveries existing
          where existing.campaign_id = item.id and existing.phone_key = people.phone_key
        )
      order by first_name, profile_id
    loop
      select status into current_status from public.sms_campaigns where id = item.id;
      exit when current_status is distinct from 'sending';
      rendered := public.sms_campaign_text(item.body, person.first_name, item.purpose);
      recent := 0;
      if item.purpose = 'promotional' then
        select count(*) into recent
        from (
          select deliveries.profile_id
          from public.admin_announcement_deliveries deliveries
          join public.admin_announcements sent on sent.id = deliveries.announcement_id
          where deliveries.profile_id = person.profile_id
            and sent.purpose = 'promotional'
            and deliveries.attempted_at > now() - interval '24 hours'
            and (deliveries.in_app = 'sent' or deliveries.push = 'provider_accepted' or deliveries.sms in ('mocked', 'sent'))
          union all
          select deliveries.profile_id
          from public.sms_campaign_deliveries deliveries
          join public.sms_campaigns sent on sent.id = deliveries.campaign_id
          where deliveries.profile_id = person.profile_id
            and sent.purpose = 'promotional'
            and deliveries.created_at > now() - interval '24 hours'
            and deliveries.status in ('mocked', 'sent')
        ) prior;
      end if;
      sms_state := 'skipped';
      sms_after := null;
      consent_reason := null;
      select case
        when exists (
          select 1 from public.sms_consents consents
          where consents.profile_id = person.profile_id and consents.opted_out_at is not null
        ) then 'opted_out'
        when not exists (
          select 1 from public.notification_preferences prefs
          where prefs.profile_id = person.profile_id and coalesce(prefs.promotional_sms, false)
        ) then 'no_marketing_consent'
        else null
      end into consent_reason;
      if consent_reason is null and recent >= 3 then
        sms_state := 'skipped';
      elsif consent_reason is null then
        select state, send_after into sms_state, sms_after
        from public.announcement_sms_state(person.profile_id, 'promotional', now());
      end if;
      insert into public.sms_campaign_deliveries (
        campaign_id, profile_id, phone_key, first_name, body, segments, status, reason, send_after
      ) values (
        item.id,
        person.profile_id,
        person.phone_key,
        person.first_name,
        rendered,
        case when char_length(rendered) <= 160 then 1 else ceil(char_length(rendered)::numeric / 153)::integer end,
        case when recent >= 3 then 'skipped' when sms_state = 'deferred' then 'deferred' when sms_state = 'mocked' then 'mocked' else 'skipped' end,
        case
          when consent_reason is not null then consent_reason
          when recent >= 3 then 'daily_limit'
          when sms_state = 'deferred' then 'quiet_hours'
          when sms_state = 'mocked' then null
          else 'texting_off'
        end,
        sms_after
      )
      on conflict (campaign_id, phone_key) do nothing;
    end loop;
    select status into current_status from public.sms_campaigns where id = item.id;
    if current_status = 'sending' then
      update public.sms_campaigns
      set status = 'sent', finished_at = now(), updated_at = now()
      where id = item.id;
    end if;
    handled := handled + 1;
  end loop;
  perform set_config('pickuply.announcement_test_lane', '', true);
  return handled;
end;
$$;

revoke all on function public.execute_due_sms_campaigns() from public, anon, authenticated;
grant execute on function public.execute_due_sms_campaigns() to service_role;
