-- Lightweight funnel events. No names, phones, emails, addresses, or documents.
-- Local only until the owner applies it to the hosted project.

create table public.funnel_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  step text not null default '',
  service text,
  pricing_method text,
  zone_slug text,
  session_id uuid not null,
  user_id uuid,
  source text,
  created_at timestamptz not null default now(),
  constraint funnel_events_name check (
    event_name in (
      'request_started', 'request_screen', 'request_verified', 'request_submitted',
      'quote_sent', 'quote_viewed', 'quote_accepted',
      'driver_apply_started', 'driver_submitted', 'driver_checklist',
      'driver_approved', 'driver_online', 'driver_claim'
    )
  ),
  constraint funnel_events_step check (step ~ '^[a-z0-9_]{0,40}$'),
  constraint funnel_events_service check (
    service is null or service in ('delivery', 'junk', 'free_item', 'construction')
  ),
  constraint funnel_events_price check (
    pricing_method is null or pricing_method in ('quote', 'fixed', 'range')
  ),
  constraint funnel_events_zone check (
    zone_slug is null or zone_slug in ('west_metro', 'east_gwinnett')
  ),
  constraint funnel_events_source check (
    source is null or source ~ '^[a-z0-9_-]{1,40}$'
  )
);

alter table public.funnel_events enable row level security;

create policy funnel_events_own_read on public.funnel_events
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke all on table public.funnel_events from anon, authenticated, public;
grant select on table public.funnel_events to authenticated;

create or replace function public.record_funnel_event(
  event_name text,
  step text,
  service text,
  pricing_method text,
  zone_slug text,
  session_id uuid,
  source text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if session_id is null then
    raise exception 'session required';
  end if;
  if event_name = 'driver_online' and auth.uid() is not null and exists (
    select 1 from public.funnel_events
    where funnel_events.event_name = 'driver_online' and user_id = auth.uid()
  ) then
    return;
  end if;
  if event_name = 'driver_claim' and auth.uid() is not null and exists (
    select 1 from public.funnel_events
    where funnel_events.event_name = 'driver_claim' and user_id = auth.uid()
  ) then
    return;
  end if;
  insert into public.funnel_events (
    event_name, step, service, pricing_method, zone_slug, session_id, user_id, source
  ) values (
    event_name,
    coalesce(step, ''),
    nullif(service, ''),
    nullif(pricing_method, ''),
    nullif(zone_slug, ''),
    session_id,
    auth.uid(),
    nullif(source, '')
  );
end;
$$;

revoke all on function public.record_funnel_event(text, text, text, text, text, uuid, text) from public;
grant execute on function public.record_funnel_event(text, text, text, text, text, uuid, text) to anon, authenticated;

create or replace function public.delete_expired_funnel_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.funnel_events
  where created_at < now() - interval '90 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.delete_expired_funnel_events() from public, anon, authenticated;
grant execute on function public.delete_expired_funnel_events() to service_role;

create or replace function public.admin_funnel(range_start date, range_end date, source_filter text)
returns table (event_name text, step text, sessions bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can read the funnel';
  end if;
  return query
  select events.event_name, events.step, count(distinct events.session_id)
  from public.funnel_events as events
  where events.created_at >= range_start
    and events.created_at < range_end + 1
    and (nullif(source_filter, '') is null or events.source = source_filter)
  group by events.event_name, events.step;
end;
$$;

revoke all on function public.admin_funnel(date, date, text) from public, anon, service_role;
grant execute on function public.admin_funnel(date, date, text) to authenticated;
