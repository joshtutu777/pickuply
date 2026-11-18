-- First-party lead visits for the admin dashboard.
-- Do not apply this file to the hosted project until the owner approves.
-- A row is written only when consent_choice is exactly granted.
-- Rejected and unanswered choices write no visit, step, attribution, or rate-limit row.
-- Granted calls are limited by UTC minute, hour, and day counters, not only by the 12-step session cap.
-- A click id is never turned into a campaign id. The request row does not store the click id.

create table public.lead_visits (
  session_id uuid primary key,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  consent text not null default 'unknown',
  landing_path text,
  referrer_host text,
  first_landing_path text,
  first_referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  first_utm_source text,
  first_utm_medium text,
  first_utm_campaign text,
  first_utm_content text,
  first_utm_term text,
  fbclid text,
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_id text,
  first_meta_campaign_id text,
  first_meta_adset_id text,
  first_meta_ad_id text,
  constraint lead_visits_consent check (consent in ('granted', 'denied', 'unknown'))
);

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  stage text not null,
  service text,
  created_at timestamptz not null default now(),
  constraint lead_events_stage check (
    stage in (
      'landing_viewed', 'request_viewed', 'request_started', 'service_selected',
      'what_completed', 'where_completed', 'price_reached', 'verify_reached',
      'request_submitted'
    )
  ),
  constraint lead_events_service check (
    service is null or service in ('delivery', 'free_item', 'junk', 'construction')
  )
);

create index lead_events_created_idx on public.lead_events (created_at);
create unique index lead_events_session_stage_key on public.lead_events (session_id, stage);
create index lead_visits_last_seen_idx on public.lead_visits (last_seen_at);

create table public.job_attribution (
  job_id uuid primary key references public.jobs (id) on delete cascade,
  first_utm_source text,
  last_utm_source text,
  first_utm_medium text,
  last_utm_medium text,
  first_utm_campaign text,
  last_utm_campaign text,
  first_utm_content text,
  last_utm_content text,
  first_utm_term text,
  last_utm_term text,
  first_referrer_host text,
  last_referrer_host text,
  first_landing_path text,
  last_landing_path text,
  first_meta_campaign_id text,
  last_meta_campaign_id text,
  first_meta_adset_id text,
  last_meta_adset_id text,
  first_meta_ad_id text,
  last_meta_ad_id text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.lead_visits enable row level security;
alter table public.lead_events enable row level security;
alter table public.job_attribution enable row level security;

-- Signed-in admins can read visit rows. Everyone else, including the visitor who created them, cannot.
create policy lead_visits_admin_read on public.lead_visits
  for select to authenticated
  using (public.is_admin());

-- Signed-in admins can read step rows. There is no public or customer read policy.
create policy lead_events_admin_read on public.lead_events
  for select to authenticated
  using (public.is_admin());

-- Signed-in admins can read the campaign saved on a request. The customer cannot read it back.
create policy job_attribution_admin_read on public.job_attribution
  for select to authenticated
  using (public.is_admin());

revoke all on public.lead_visits from public, anon, authenticated;
revoke all on public.lead_events from public, anon, authenticated;
revoke all on public.job_attribution from public, anon, authenticated;
grant select on public.lead_visits to authenticated;
grant select on public.lead_events to authenticated;
grant select on public.job_attribution to authenticated;

create or replace function public.lead_clean_text(value text, max_length integer)
returns text
language plpgsql
immutable
as $$
declare
  trimmed text := nullif(btrim(value), '');
begin
  if trimmed is null or char_length(trimmed) > max_length then
    return null;
  end if;
  if trimmed !~ '^[A-Za-z0-9 ._+|-]+$' then
    return null;
  end if;
  return trimmed;
end;
$$;

create or replace function public.record_lead_activity(
  browser_session uuid,
  stage_name text,
  service_name text,
  consent_choice text,
  landing_path text,
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  click_id text,
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_consent text := case when consent_choice in ('granted', 'denied', 'unknown') then consent_choice else 'unknown' end;
  clean_stage text := stage_name;
  clean_service text := nullif(service_name, '');
  clean_path text := null;
  clean_host text := null;
  clean_source text := null;
  clean_medium text := null;
  clean_campaign text := null;
  clean_content text := null;
  clean_term text := null;
  clean_click text := null;
  clean_meta_campaign text := null;
  clean_meta_adset text := null;
  clean_meta_ad text := null;
begin
  if browser_session is null then
    raise exception 'lead event rejected';
  end if;
  -- Reject oversized input before any table write. The message does not echo the value.
  if stage_name is not null and char_length(stage_name) > 40
    or service_name is not null and char_length(service_name) > 32
    or consent_choice is not null and char_length(consent_choice) > 20
    or landing_path is not null and char_length(landing_path) > 120
    or referrer_host is not null and char_length(referrer_host) > 120
    or utm_source is not null and char_length(utm_source) > 80
    or utm_medium is not null and char_length(utm_medium) > 80
    or utm_campaign is not null and char_length(utm_campaign) > 120
    or utm_content is not null and char_length(utm_content) > 120
    or utm_term is not null and char_length(utm_term) > 120
    or click_id is not null and char_length(click_id) > 200
    or meta_campaign_id is not null and char_length(meta_campaign_id) > 32
    or meta_adset_id is not null and char_length(meta_adset_id) > 32
    or meta_ad_id is not null and char_length(meta_ad_id) > 32
  then
    raise exception 'lead event rejected';
  end if;
  if clean_stage not in (
    'landing_viewed', 'request_viewed', 'request_started', 'service_selected',
    'what_completed', 'where_completed', 'price_reached', 'verify_reached',
    'request_submitted'
  ) then
    raise exception 'lead event rejected';
  end if;
  -- Rejection and an unanswered cookie banner store nothing, including rate counters.
  if allowed_consent is distinct from 'granted' then
    return;
  end if;
  if not public.lead_rate_allow(browser_session) then
    return;
  end if;
  if (select count(*) from public.lead_events where session_id = browser_session) >= 12 then
    update public.lead_visits set last_seen_at = now() where session_id = browser_session;
    return;
  end if;
  if clean_service is not null and clean_service not in ('delivery', 'free_item', 'junk', 'construction') then
    clean_service := null;
  end if;
  if landing_path is not null and landing_path ~ '^/[A-Za-z0-9_./-]{0,119}$' then
    clean_path := landing_path;
  end if;
  if referrer_host is not null and referrer_host ~ '^[a-z0-9.-]{1,120}$' then
    clean_host := referrer_host;
  end if;
  if allowed_consent = 'granted' then
    clean_source := public.lead_clean_text(utm_source, 80);
    clean_medium := public.lead_clean_text(utm_medium, 80);
    clean_campaign := public.lead_clean_text(utm_campaign, 120);
    clean_content := public.lead_clean_text(utm_content, 120);
    clean_term := public.lead_clean_text(utm_term, 120);
    clean_meta_campaign := case when meta_campaign_id ~ '^[0-9]{1,32}$' then meta_campaign_id else null end;
    clean_meta_adset := case when meta_adset_id ~ '^[0-9]{1,32}$' then meta_adset_id else null end;
    clean_meta_ad := case when meta_ad_id ~ '^[0-9]{1,32}$' then meta_ad_id else null end;
    if click_id is not null and click_id ~ '^[A-Za-z0-9_-]{1,200}$' then
      clean_click := click_id;
    end if;
  end if;

  insert into public.lead_visits (
    session_id, consent, landing_path, referrer_host, first_landing_path, first_referrer_host,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    first_utm_source, first_utm_medium, first_utm_campaign, first_utm_content, first_utm_term,
    fbclid, meta_campaign_id, meta_adset_id, meta_ad_id,
    first_meta_campaign_id, first_meta_adset_id, first_meta_ad_id
  ) values (
    browser_session, allowed_consent, clean_path, clean_host, clean_path, clean_host,
    clean_source, clean_medium, clean_campaign, clean_content, clean_term,
    clean_source, clean_medium, clean_campaign, clean_content, clean_term,
    clean_click, clean_meta_campaign, clean_meta_adset, clean_meta_ad,
    clean_meta_campaign, clean_meta_adset, clean_meta_ad
  )
  on conflict (session_id) do update set
    last_seen_at = now(),
    consent = case
      when excluded.consent = 'granted' or lead_visits.consent = 'granted' then 'granted'
      when excluded.consent = 'denied' then 'denied'
      else lead_visits.consent
    end,
    landing_path = coalesce(excluded.landing_path, lead_visits.landing_path),
    referrer_host = coalesce(excluded.referrer_host, lead_visits.referrer_host),
    first_landing_path = coalesce(lead_visits.first_landing_path, excluded.landing_path),
    first_referrer_host = coalesce(lead_visits.first_referrer_host, excluded.referrer_host),
    utm_source = coalesce(excluded.utm_source, lead_visits.utm_source),
    utm_medium = coalesce(excluded.utm_medium, lead_visits.utm_medium),
    utm_campaign = coalesce(excluded.utm_campaign, lead_visits.utm_campaign),
    utm_content = coalesce(excluded.utm_content, lead_visits.utm_content),
    utm_term = coalesce(excluded.utm_term, lead_visits.utm_term),
    first_utm_source = coalesce(lead_visits.first_utm_source, excluded.utm_source),
    first_utm_medium = coalesce(lead_visits.first_utm_medium, excluded.utm_medium),
    first_utm_campaign = coalesce(lead_visits.first_utm_campaign, excluded.utm_campaign),
    first_utm_content = coalesce(lead_visits.first_utm_content, excluded.utm_content),
    first_utm_term = coalesce(lead_visits.first_utm_term, excluded.utm_term),
    fbclid = coalesce(lead_visits.fbclid, excluded.fbclid),
    meta_campaign_id = coalesce(excluded.meta_campaign_id, lead_visits.meta_campaign_id),
    meta_adset_id = coalesce(excluded.meta_adset_id, lead_visits.meta_adset_id),
    meta_ad_id = coalesce(excluded.meta_ad_id, lead_visits.meta_ad_id),
    first_meta_campaign_id = coalesce(lead_visits.first_meta_campaign_id, excluded.meta_campaign_id),
    first_meta_adset_id = coalesce(lead_visits.first_meta_adset_id, excluded.meta_adset_id),
    first_meta_ad_id = coalesce(lead_visits.first_meta_ad_id, excluded.meta_ad_id);

  insert into public.lead_events (session_id, stage, service)
  values (browser_session, clean_stage, clean_service)
  on conflict (session_id, stage) do nothing;
end;
$$;

revoke all on function public.record_lead_activity(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.record_lead_activity(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

create or replace function public.attach_job_attribution(target_job uuid, browser_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  visit public.lead_visits;
begin
  if auth.uid() is null or target_job is null or browser_session is null then
    raise exception 'lead event rejected';
  end if;
  if not exists (
    select 1 from public.jobs
    where jobs.id = target_job and jobs.customer_id = auth.uid()
  ) then
    raise exception 'lead event rejected';
  end if;
  if exists (select 1 from public.job_attribution where job_id = target_job) then
    return;
  end if;
  select * into visit from public.lead_visits where session_id = browser_session;
  if not found or visit.consent is distinct from 'granted' then
    return;
  end if;
  insert into public.job_attribution (
    job_id,
    first_utm_source, last_utm_source,
    first_utm_medium, last_utm_medium,
    first_utm_campaign, last_utm_campaign,
    first_utm_content, last_utm_content,
    first_utm_term, last_utm_term,
    first_referrer_host, last_referrer_host,
    first_landing_path, last_landing_path,
    first_meta_campaign_id, last_meta_campaign_id,
    first_meta_adset_id, last_meta_adset_id,
    first_meta_ad_id, last_meta_ad_id,
    first_seen_at, last_seen_at
  ) values (
    target_job,
    visit.first_utm_source, coalesce(visit.utm_source, visit.first_utm_source),
    visit.first_utm_medium, coalesce(visit.utm_medium, visit.first_utm_medium),
    visit.first_utm_campaign, coalesce(visit.utm_campaign, visit.first_utm_campaign),
    visit.first_utm_content, coalesce(visit.utm_content, visit.first_utm_content),
    visit.first_utm_term, coalesce(visit.utm_term, visit.first_utm_term),
    visit.first_referrer_host, coalesce(visit.referrer_host, visit.first_referrer_host),
    visit.first_landing_path, coalesce(visit.landing_path, visit.first_landing_path),
    visit.first_meta_campaign_id, coalesce(visit.meta_campaign_id, visit.first_meta_campaign_id),
    visit.first_meta_adset_id, coalesce(visit.meta_adset_id, visit.first_meta_adset_id),
    visit.first_meta_ad_id, coalesce(visit.meta_ad_id, visit.first_meta_ad_id),
    visit.started_at, visit.last_seen_at
  );
end;
$$;

revoke all on function public.attach_job_attribution(uuid, uuid) from public, anon;
grant execute on function public.attach_job_attribution(uuid, uuid) to authenticated;

revoke all on function public.lead_clean_text(text, integer) from public, anon, authenticated;

-- Counters for anonymous lead writes. No session id, campaign, or customer is stored here.
-- There is no read policy: visitors and customers cannot see the counters.
create table public.lead_rate_buckets (
  scope text not null,
  bucket timestamptz not null,
  new_sessions integer not null default 0,
  events integer not null default 0,
  primary key (scope, bucket),
  constraint lead_rate_buckets_scope check (scope in ('minute', 'hour', 'day')),
  constraint lead_rate_buckets_counts check (new_sessions >= 0 and events >= 0)
);

alter table public.lead_rate_buckets enable row level security;

revoke all on public.lead_rate_buckets from public, anon, authenticated;

-- Returns true when this granted call is inside the anonymous write budget.
-- The lock keeps parallel steps for one browser session from counting as several new sessions.
create or replace function public.lead_rate_allow(browser_session uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  minute_at timestamptz := date_trunc('minute', now());
  hour_at timestamptz := date_trunc('hour', now());
  day_at timestamptz := date_trunc('day', now());
  is_new boolean := false;
  minute_events integer := 0;
  minute_sessions integer := 0;
  hour_events integer := 0;
  hour_sessions integer := 0;
  day_events integer := 0;
  day_sessions integer := 0;
begin
  if browser_session is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(browser_session::text, 0));

  delete from public.lead_rate_buckets
  where (scope = 'minute' and bucket < now() - interval '2 hours')
     or (scope = 'hour' and bucket < now() - interval '2 days')
     or (scope = 'day' and bucket < now() - interval '14 days');

  is_new := not exists (
    select 1 from public.lead_visits where session_id = browser_session
  );

  insert into public.lead_rate_buckets as rate (scope, bucket, new_sessions, events)
  values ('minute', minute_at, case when is_new then 1 else 0 end, 1)
  on conflict (scope, bucket) do update
  set events = rate.events + 1,
      new_sessions = rate.new_sessions + case when is_new then 1 else 0 end
  returning events, new_sessions into minute_events, minute_sessions;

  insert into public.lead_rate_buckets as rate (scope, bucket, new_sessions, events)
  values ('hour', hour_at, case when is_new then 1 else 0 end, 1)
  on conflict (scope, bucket) do update
  set events = rate.events + 1,
      new_sessions = rate.new_sessions + case when is_new then 1 else 0 end
  returning events, new_sessions into hour_events, hour_sessions;

  insert into public.lead_rate_buckets as rate (scope, bucket, new_sessions, events)
  values ('day', day_at, case when is_new then 1 else 0 end, 1)
  on conflict (scope, bucket) do update
  set events = rate.events + 1,
      new_sessions = rate.new_sessions + case when is_new then 1 else 0 end
  returning events, new_sessions into day_events, day_sessions;

  -- Local-marketplace budget: 60 new sessions and 400 calls a minute,
  -- 500 new sessions and 4,000 calls an hour, 2,000 new sessions and 15,000 calls a UTC day.
  if minute_events > 400 or hour_events > 4000 or day_events > 15000 then
    return false;
  end if;
  if is_new and (minute_sessions > 60 or hour_sessions > 500 or day_sessions > 2000) then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.lead_rate_allow(uuid) from public, anon, authenticated;
