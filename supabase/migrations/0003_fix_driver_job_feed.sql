-- Replace driver_job_feed() so the profile lookup is not ambiguous.
-- returns table (id uuid, ...) creates a PL/pgSQL variable named id.
-- "where id = uid" then matches both that variable and profiles.id.
-- Qualifying profiles.id keeps the same eligibility, privacy, and assignment rules.
-- Other functions were reviewed. Only this one returns a table column named id
-- and also reads profiles.id. They do not have this clash.

create or replace function public.driver_job_feed()
returns table (
  id uuid,
  service public.job_service,
  pieces integer,
  size public.item_size,
  pickup_area text,
  dropoff_area text,
  distance_miles numeric,
  stairs_pickup integer,
  stairs_dropoff integer,
  elevator boolean,
  help_loading boolean,
  preferred_date text,
  time_window public.time_window,
  pricing_method public.pricing_method,
  offer_cents integer,
  budget_min_cents integer,
  budget_max_cents integer,
  driver_pay_cents integer,
  quote_expires_at timestamptz,
  junk_load_size public.junk_load_size,
  service_level public.service_level,
  required_vehicle public.vehicle_type,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  profile_row public.profiles%rowtype;
  driver_row public.drivers%rowtype;
begin
  if uid is null then
    return;
  end if;

  select * into profile_row from public.profiles where profiles.id = uid;
  if not found or profile_row.role <> 'driver' or profile_row.blocked then
    return;
  end if;

  select * into driver_row from public.drivers where profile_id = uid;
  if not found or driver_row.status not in ('active', 'approved_new') then
    return;
  end if;

  return query
  select
    j.id,
    j.service,
    j.pieces,
    j.size,
    j.pickup_area,
    j.dropoff_area,
    j.distance_miles,
    j.stairs_pickup,
    j.stairs_dropoff,
    j.elevator,
    j.help_loading,
    j.preferred_date,
    j.time_window,
    j.pricing_method,
    case when j.pricing_method = 'fixed' then j.offer_cents else null end,
    case when j.pricing_method = 'range' then j.budget_min_cents else null end,
    case when j.pricing_method = 'range' then j.budget_max_cents else null end,
    case when j.pricing_method = 'quote' then j.driver_pay_cents else null end,
    case when j.pricing_method = 'quote' then j.quote_expires_at else null end,
    j.junk_load_size,
    j.service_level,
    j.required_vehicle,
    j.created_at
  from public.jobs j
  where j.status = 'open'
    and public.driver_is_eligible_for_job(j.id);
end;
$$;
