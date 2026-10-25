-- Driver Terms are accepted at Quick Apply. The home ZIP picks the zone.
-- There is no separate service-area choice on the form.

alter table public.drivers
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz;

create or replace function public.submit_quick_application(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  applicant_name text;
  zone uuid;
  existing public.drivers%rowtype;
  driver_exists boolean := false;
  zip_value text := nullif(btrim(coalesce(payload->>'home_zip', '')), '');
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  applicant_name := btrim(coalesce(payload->>'full_name', ''));
  if applicant_name !~ '^[A-Za-z][A-Za-z .''-]{1,79}$' then
    raise exception 'enter your full name';
  end if;
  if coalesce(payload->>'contact_ok', '') <> 'true' then
    raise exception 'agree to be contacted about this application';
  end if;
  if coalesce(payload->>'terms_ok', '') <> 'true' then
    raise exception 'agree to the driver terms';
  end if;
  if length(btrim(coalesce(payload->>'home_city', ''))) < 2 then
    raise exception 'enter your home city';
  end if;
  if zip_value is null or not exists (select 1 from public.ga_zip_centroids where zip = zip_value) then
    raise exception 'Enter a Georgia home ZIP code.';
  end if;
  if nullif(payload->>'zone_id', '') is not null then
    zone := (payload->>'zone_id')::uuid;
  else
    select zones.id into zone
    from public.zones
    join public.ga_zip_centroids centroid on centroid.zip = zip_value
    where zones.active
    order by public.private_miles_between(centroid.lat, centroid.lng, zones.center_lat, zones.center_lng)
    limit 1;
  end if;
  if zone is null or not exists (select 1 from public.zones where id = zone and active) then
    raise exception 'choose a service area';
  end if;
  if payload->>'service_level' not in ('light', 'full') then
    raise exception 'choose light load or full service';
  end if;
  if payload->>'vehicle_type' not in ('car', 'suv', 'pickup', 'van', 'box_truck', 'trailer') then
    raise exception 'choose a vehicle type';
  end if;
  if coalesce(payload->>'photo_path', '') !~ ('^' || uid::text || '/profile\.(jpg|jpeg|png|webp)$') then
    raise exception 'upload a profile photo';
  end if;
  if coalesce(payload->>'license_path', '') !~ ('^' || uid::text || '/license\.(jpg|jpeg|png|webp)$') then
    raise exception 'upload a photo of your driver license';
  end if;
  if (payload->>'license_expires')::date < current_date then
    raise exception 'your license expiration must be in the future';
  end if;
  select * into existing from public.drivers where profile_id = uid;
  driver_exists := found;
  if driver_exists and existing.status in ('active', 'approved_new', 'paused') then
    raise exception 'this driver account is already reviewed';
  end if;
  update public.profiles
  set full_name = applicant_name, photo_url = payload->>'photo_path'
  where id = uid;
  perform set_config('pickuply.driver_application', 'yes', true);
  if not driver_exists then
    insert into public.drivers (
      profile_id, status, zone_id, home_city, home_zip, max_distance_miles, service_level,
      services, license_url, license_expires, checklist_required, contact_consent_at,
      review_note, is_online, terms_version, terms_accepted_at, agreement_signed_at
    ) values (
      uid, 'pending_review', zone, btrim(payload->>'home_city'), zip_value, 25,
      (payload->>'service_level')::public.service_level, '{}',
      payload->>'license_path', (payload->>'license_expires')::date,
      true, now(), null, false, 'driver-terms-v1', now(), now()
    );
  else
    update public.drivers
    set
      status = 'pending_review',
      zone_id = zone,
      home_city = btrim(payload->>'home_city'),
      home_zip = zip_value,
      service_level = (payload->>'service_level')::public.service_level,
      license_url = payload->>'license_path',
      license_expires = (payload->>'license_expires')::date,
      checklist_required = true,
      contact_consent_at = now(),
      review_note = null,
      is_online = false,
      terms_version = 'driver-terms-v1',
      terms_accepted_at = now(),
      agreement_signed_at = coalesce(agreement_signed_at, now())
    where profile_id = uid;
  end if;
  if not exists (select 1 from public.vehicles where driver_id = uid) then
    insert into public.vehicles (driver_id, type, approved)
    values (uid, (payload->>'vehicle_type')::public.vehicle_type, false);
  else
    update public.vehicles
    set type = (payload->>'vehicle_type')::public.vehicle_type
    where id = (
      select id from public.vehicles where driver_id = uid order by created_at desc limit 1
    );
  end if;
  if payload ? 'coverage' then
    perform public.apply_driver_coverage(
      uid,
      coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(payload->'coverage'->'cities', '[]'::jsonb))), '{}'::text[]),
      coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(payload->'coverage'->'zips', '[]'::jsonb))), '{}'::text[]),
      nullif(payload->'coverage'->>'radius', '')::integer,
      payload->'coverage'->>'radius_zip'
    );
  else
    perform public.apply_driver_coverage(uid, '{}', '{}', 25, null);
  end if;
end;
$$;
