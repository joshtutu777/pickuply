-- Private home and saved addresses, trip miles, and a one-time coordinate backfill.
-- Exact coordinates stay off the driver feed.

alter table public.job_private
  add column if not exists pickup_unit text,
  add column if not exists dropoff_unit text,
  add column if not exists pickup_verified boolean,
  add column if not exists dropoff_verified boolean;

alter table public.jobs
  add column if not exists distance_source text;

alter table public.jobs
  drop constraint if exists jobs_distance_source_check;

alter table public.jobs
  add constraint jobs_distance_source_check
  check (distance_source is null or distance_source in ('driving', 'straight'));

create table if not exists public.driver_places (
  profile_id uuid primary key references public.drivers (profile_id) on delete cascade,
  line1 text not null,
  unit text,
  city text not null,
  zip text not null,
  lat double precision,
  lng double precision,
  verified boolean not null default false,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_places (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  label text not null,
  line1 text not null,
  unit text,
  city text not null,
  zip text not null,
  lat double precision,
  lng double precision,
  verified boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.driver_places enable row level security;
alter table public.customer_places enable row level security;

drop policy if exists driver_places_read on public.driver_places;
create policy driver_places_read on public.driver_places
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

drop policy if exists customer_places_read on public.customer_places;
create policy customer_places_read on public.customer_places
  for select to authenticated
  using (customer_id = auth.uid() or public.is_admin());

revoke all on public.driver_places from public, anon, authenticated;
revoke all on public.customer_places from public, anon, authenticated;
grant select on public.driver_places to authenticated;
grant select on public.customer_places to authenticated;

create or replace function public.round_half_mile(miles numeric)
returns numeric
language sql
immutable
as $$
  select case when miles is null then null else round(miles * 2) / 2 end;
$$;

create or replace function public.save_driver_place(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  zip_value text := nullif(btrim(coalesce(payload->>'zip', '')), '');
  city_value text := nullif(btrim(coalesce(payload->>'city', '')), '');
  line_value text := nullif(btrim(coalesce(payload->>'line1', '')), '');
  centroid public.ga_zip_centroids%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if not exists (select 1 from public.drivers where profile_id = uid) then
    raise exception 'finish the application first';
  end if;
  if line_value is null or char_length(line_value) > 200 then
    raise exception 'enter a street address';
  end if;
  if city_value is null then
    raise exception 'enter a Georgia city';
  end if;
  select * into centroid from public.ga_zip_centroids where zip = zip_value;
  if centroid.zip is null then
    raise exception 'Pickuply currently serves Georgia ZIP codes only.';
  end if;
  insert into public.driver_places (
    profile_id, line1, unit, city, zip, lat, lng, verified, notes, updated_at
  ) values (
    uid,
    line_value,
    nullif(btrim(coalesce(payload->>'unit', '')), ''),
    centroid.city,
    centroid.zip,
    case when coalesce(payload->>'verified', '') = 'true' then nullif(payload->>'lat', '')::double precision else null end,
    case when coalesce(payload->>'verified', '') = 'true' then nullif(payload->>'lng', '')::double precision else null end,
    coalesce(payload->>'verified', '') = 'true',
    nullif(btrim(coalesce(payload->>'notes', '')), ''),
    now()
  )
  on conflict (profile_id) do update set
    line1 = excluded.line1,
    unit = excluded.unit,
    city = excluded.city,
    zip = excluded.zip,
    lat = excluded.lat,
    lng = excluded.lng,
    verified = excluded.verified,
    notes = excluded.notes,
    updated_at = now();
  update public.drivers
  set home_city = centroid.city, home_zip = centroid.zip
  where profile_id = uid;
end;
$$;

create or replace function public.save_customer_place(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  place_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  zip_value text := nullif(btrim(coalesce(payload->>'zip', '')), '');
  centroid public.ga_zip_centroids%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into centroid from public.ga_zip_centroids where zip = zip_value;
  if centroid.zip is null then
    raise exception 'Pickuply currently serves Georgia ZIP codes only.';
  end if;
  if nullif(btrim(coalesce(payload->>'line1', '')), '') is null then
    raise exception 'enter a street address';
  end if;
  insert into public.customer_places (
    id, customer_id, label, line1, unit, city, zip, lat, lng, verified, notes
  ) values (
    place_id,
    uid,
    coalesce(nullif(btrim(coalesce(payload->>'label', '')), ''), 'Home'),
    btrim(payload->>'line1'),
    nullif(btrim(coalesce(payload->>'unit', '')), ''),
    centroid.city,
    centroid.zip,
    case when coalesce(payload->>'verified', '') = 'true' then nullif(payload->>'lat', '')::double precision else null end,
    case when coalesce(payload->>'verified', '') = 'true' then nullif(payload->>'lng', '')::double precision else null end,
    coalesce(payload->>'verified', '') = 'true',
    nullif(btrim(coalesce(payload->>'notes', '')), '')
  )
  on conflict (id) do update set
    label = excluded.label,
    line1 = excluded.line1,
    unit = excluded.unit,
    city = excluded.city,
    zip = excluded.zip,
    lat = excluded.lat,
    lng = excluded.lng,
    verified = excluded.verified,
    notes = excluded.notes
  where customer_places.customer_id = uid;
  return place_id;
end;
$$;

create or replace function public.save_job_places(job_id uuid, payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  pickup_zip text;
  dropoff_zip text;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into job_row from public.jobs where id = job_id;
  if job_row.id is null then
    raise exception 'request not found';
  end if;
  if job_row.customer_id is distinct from uid and not public.is_admin() then
    raise exception 'request not found';
  end if;
  pickup_zip := substring(job_row.pickup_area from '([0-9]{5})');
  dropoff_zip := substring(coalesce(job_row.dropoff_area, '') from '([0-9]{5})');
  update public.job_private
  set
    pickup_unit = nullif(btrim(coalesce(payload->>'pickup_unit', '')), ''),
    dropoff_unit = nullif(btrim(coalesce(payload->>'dropoff_unit', '')), ''),
    pickup_verified = coalesce(payload->>'pickup_verified', '') = 'true',
    dropoff_verified = coalesce(payload->>'dropoff_verified', '') = 'true',
    pickup_lat = case
      when coalesce(payload->>'pickup_verified', '') = 'true' then nullif(payload->>'pickup_lat', '')::double precision
      else null
    end,
    pickup_lng = case
      when coalesce(payload->>'pickup_verified', '') = 'true' then nullif(payload->>'pickup_lng', '')::double precision
      else null
    end,
    dropoff_lat = case
      when coalesce(payload->>'dropoff_verified', '') = 'true' then nullif(payload->>'dropoff_lat', '')::double precision
      else null
    end,
    dropoff_lng = case
      when coalesce(payload->>'dropoff_verified', '') = 'true' then nullif(payload->>'dropoff_lng', '')::double precision
      else null
    end
  where job_private.job_id = save_job_places.job_id;
  if pickup_zip is not null and not exists (select 1 from public.ga_zip_centroids where zip = pickup_zip) then
    raise exception 'Pickuply currently serves Georgia ZIP codes only.';
  end if;
end;
$$;

create or replace function public.set_job_trip_miles(job_id uuid, miles numeric, source text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  private_row public.job_private%rowtype;
  straight numeric;
  stored numeric;
  stored_source text;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into job_row from public.jobs where id = job_id;
  if job_row.id is null or (job_row.customer_id is distinct from uid and not public.is_admin()) then
    raise exception 'request not found';
  end if;
  select * into private_row from public.job_private where job_private.job_id = set_job_trip_miles.job_id;
  straight := public.round_half_mile(public.private_miles_between(
    private_row.pickup_lat, private_row.pickup_lng, private_row.dropoff_lat, private_row.dropoff_lng
  ));
  if straight is null then
    straight := public.round_half_mile(public.private_miles_between(
      (select lat from public.ga_zip_centroids where zip = substring(job_row.pickup_area from '([0-9]{5})')),
      (select lng from public.ga_zip_centroids where zip = substring(job_row.pickup_area from '([0-9]{5})')),
      (select lat from public.ga_zip_centroids where zip = substring(coalesce(job_row.dropoff_area, '') from '([0-9]{5})')),
      (select lng from public.ga_zip_centroids where zip = substring(coalesce(job_row.dropoff_area, '') from '([0-9]{5})'))
    ));
    stored := straight;
    stored_source := case when straight is null then null else 'straight' end;
  elsif source = 'driving' and miles is not null and miles >= straight and miles <= straight * 3 then
    stored := public.round_half_mile(miles);
    stored_source := 'driving';
  else
    stored := straight;
    stored_source := 'straight';
  end if;
  update public.jobs
  set distance_miles = stored, distance_source = stored_source
  where id = job_id;
end;
$$;

revoke all on function public.save_driver_place(jsonb) from public, anon;
revoke all on function public.save_customer_place(jsonb) from public, anon;
revoke all on function public.save_job_places(uuid, jsonb) from public, anon;
revoke all on function public.set_job_trip_miles(uuid, numeric, text) from public, anon;
grant execute on function public.save_driver_place(jsonb) to authenticated;
grant execute on function public.save_customer_place(jsonb) to authenticated;
grant execute on function public.save_job_places(uuid, jsonb) to authenticated;
grant execute on function public.set_job_trip_miles(uuid, numeric, text) to authenticated;

-- Existing private rows: use a Georgia ZIP in the address when one is present.
update public.job_private as private_row
set
  pickup_lat = centroid.lat,
  pickup_lng = centroid.lng,
  pickup_verified = false
from public.ga_zip_centroids as centroid
where private_row.pickup_lat is null
  and centroid.zip = substring(private_row.pickup_address from '([0-9]{5})');

update public.job_private as private_row
set
  dropoff_lat = centroid.lat,
  dropoff_lng = centroid.lng,
  dropoff_verified = false
from public.ga_zip_centroids as centroid
where private_row.dropoff_lat is null
  and private_row.dropoff_address is not null
  and centroid.zip = substring(private_row.dropoff_address from '([0-9]{5})');

update public.jobs as job_row
set
  distance_miles = public.round_half_mile(public.private_miles_between(
    pickup.lat, pickup.lng, dropoff.lat, dropoff.lng
  )),
  distance_source = 'straight'
from public.ga_zip_centroids as pickup, public.ga_zip_centroids as dropoff
where job_row.distance_miles is null
  and pickup.zip = substring(job_row.pickup_area from '([0-9]{5})')
  and dropoff.zip = substring(coalesce(job_row.dropoff_area, '') from '([0-9]{5})');
