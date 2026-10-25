-- A customer marks an offer viewed only by calling mark_offers_viewed.
-- My Requests and notifications do not write these rows.

create table public.offer_views (
  offer_id uuid primary key references public.job_offers (id) on delete cascade,
  customer_id uuid not null references public.profiles (id),
  viewed_at timestamptz not null default now()
);

create index offer_views_customer_id_idx on public.offer_views (customer_id);

alter table public.offer_views enable row level security;

create policy offer_views_select_own on public.offer_views
  for select to authenticated
  using (customer_id = auth.uid() or public.is_admin());

revoke all on table public.offer_views from public, anon, authenticated, service_role;
grant select on table public.offer_views to authenticated;

create or replace function public.mark_offers_viewed(offer_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  if offer_ids is null or cardinality(offer_ids) = 0 then
    return 0;
  end if;

  insert into public.offer_views (offer_id, customer_id)
  select offers.id, auth.uid()
  from public.job_offers offers
  join public.jobs on jobs.id = offers.job_id
  where offers.id = any(offer_ids)
    and jobs.customer_id = auth.uid()
  on conflict (offer_id) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.mark_offers_viewed(uuid[]) from public, anon, service_role;
grant execute on function public.mark_offers_viewed(uuid[]) to authenticated;

create or replace function public.customer_offer_counts()
returns table (job_id uuid, active_offers integer, new_offers integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    jobs.id,
    count(offers.id) filter (
      where offers.status = 'active' and offers.expires_at > now()
    )::integer,
    count(offers.id) filter (
      where offers.status = 'active'
        and offers.expires_at > now()
        and views.offer_id is null
    )::integer
  from public.jobs
  left join public.job_offers offers on offers.job_id = jobs.id
  left join public.offer_views views on views.offer_id = offers.id
  where jobs.customer_id = auth.uid()
  group by jobs.id;
$$;

revoke all on function public.customer_offer_counts() from public, anon, service_role;
grant execute on function public.customer_offer_counts() to authenticated;

drop function public.offer_summaries(uuid);

create function public.offer_summaries(target_job uuid)
returns table (
  offer_id uuid,
  driver_first_name text,
  vehicle_label text,
  jobs_completed integer,
  reason text,
  outside_range boolean,
  customer_total_cents integer,
  driver_earnings_cents integer,
  platform_fee_cents integer,
  service_fee_cents integer,
  status public.offer_status,
  expires_at timestamptz,
  viewed boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if not exists (
    select 1 from public.jobs
    where id = target_job and (customer_id = auth.uid() or public.is_admin())
  ) then
    return;
  end if;

  return query
  select
    offers.id,
    split_part(coalesce(profiles.full_name, 'Driver'), ' ', 1),
    trim(both ' ' from coalesce(vehicles.type::text, '') || ' ' || coalesce(vehicles.make, '')),
    drivers.new_driver_jobs_completed,
    offers.reason,
    offers.outside_range,
    offers.customer_total_cents,
    offers.driver_amount_cents,
    offers.platform_fee_cents,
    offers.service_fee_cents,
    offers.status,
    offers.expires_at,
    exists (
      select 1 from public.offer_views
      where offer_views.offer_id = offers.id
    )
  from public.job_offers offers
  join public.profiles on profiles.id = offers.driver_id
  join public.drivers on drivers.profile_id = offers.driver_id
  left join lateral (
    select type, make
    from public.vehicles
    where driver_id = offers.driver_id
    order by approved desc, created_at desc
    limit 1
  ) vehicles on true
  where offers.job_id = target_job
    and offers.status = 'active'
    and offers.expires_at > now();
end;
$$;

revoke all on function public.offer_summaries(uuid) from public, anon, service_role;
grant execute on function public.offer_summaries(uuid) to authenticated;

alter table public.job_offers replica identity full;
alter table public.offer_views replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'job_offers'
    ) then
      alter publication supabase_realtime add table public.job_offers;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'offer_views'
    ) then
      alter publication supabase_realtime add table public.offer_views;
    end if;
  end if;
end $$;
