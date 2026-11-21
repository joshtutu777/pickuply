-- Aggregate landing-page loads. One row is a day, path, source category, and campaign label.
-- The count is page loads, not people. Do not apply this file until the owner approves.
-- The table has no visitor id, session id, click id, address, name, email, phone, or IP.
-- Existing payment, request, and consented-visit tables are not changed.

create table public.landing_load_counts (
  counted_on date not null,
  landing_path text not null,
  source_category text not null,
  campaign_label text not null,
  load_count integer not null default 0,
  primary key (counted_on, landing_path, source_category, campaign_label),
  constraint landing_load_counts_count check (load_count >= 0),
  constraint landing_load_counts_source check (
    source_category in ('facebook', 'instagram', 'google', 'direct', 'referral', 'other', 'unknown')
  ),
  constraint landing_load_counts_path check (landing_path ~ '^/[A-Za-z0-9_./-]{0,119}$'),
  constraint landing_load_counts_campaign check (campaign_label ~ '^[A-Za-z0-9_-]{1,40}$')
);

create table public.landing_load_minutes (
  minute_at timestamptz primary key,
  load_count integer not null,
  constraint landing_load_minutes_count check (load_count >= 0)
);

alter table public.landing_load_counts enable row level security;
alter table public.landing_load_minutes enable row level security;

create policy landing_load_counts_admin_read on public.landing_load_counts
  for select to authenticated
  using (public.is_admin());

revoke all on public.landing_load_counts from public, anon, authenticated;
revoke all on public.landing_load_minutes from public, anon, authenticated;
grant select on public.landing_load_counts to authenticated;

create or replace function public.record_landing_load(
  page_path text,
  source_name text,
  campaign_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  counted_day date := (now() at time zone 'America/New_York')::date;
  minute timestamptz := date_trunc('minute', now());
  minute_count integer := 0;
  stored_campaign text := campaign_name;
  distinct_labels integer := 0;
begin
  perform pg_advisory_xact_lock(81450145);
  if page_path is null
    or char_length(page_path) > 120
    or source_name is null
    or char_length(source_name) > 20
    or campaign_name is null
    or char_length(campaign_name) > 40
    or (
      page_path <> '/'
      and page_path !~ '^/(request|blog|contact|help|privacy|terms|terms/driver|support)$'
      and page_path !~ '^/blog/[a-z0-9-]{1,80}$'
    )
    or source_name not in ('facebook', 'instagram', 'google', 'direct', 'referral', 'other', 'unknown')
    or campaign_name !~ '^[A-Za-z0-9_-]{1,40}$'
  then
    raise exception 'landing load rejected';
  end if;

  insert into public.landing_load_minutes (minute_at, load_count)
  values (minute, 1)
  on conflict (minute_at) do update
    set load_count = public.landing_load_minutes.load_count + 1
  returning load_count into minute_count;
  delete from public.landing_load_minutes where minute_at < now() - interval '2 hours';
  if minute_count > 600 then
    update public.landing_load_minutes
      set load_count = load_count - 1
      where minute_at = minute;
    return;
  end if;

  if campaign_name <> 'other' and not exists (
    select 1
    from public.landing_load_counts
    where counted_on = counted_day and campaign_label = campaign_name
  ) then
    select count(*) into distinct_labels
    from (
      select distinct campaign_label
      from public.landing_load_counts
      where counted_on = counted_day
    ) labels;
    if distinct_labels >= 100 then
      stored_campaign := 'other';
    end if;
  end if;

  insert into public.landing_load_counts (
    counted_on, landing_path, source_category, campaign_label, load_count
  ) values (
    counted_day, page_path, source_name, stored_campaign, 1
  )
  on conflict (counted_on, landing_path, source_category, campaign_label) do update
    set load_count = public.landing_load_counts.load_count + 1;
end;
$$;

revoke all on function public.record_landing_load(text, text, text) from public;
grant execute on function public.record_landing_load(text, text, text) to anon, authenticated;
