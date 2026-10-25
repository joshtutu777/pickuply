-- A license or insurance date is valid through the end of that calendar day in Georgia.
-- current_date follows UTC, which is already the next day after 8:00 PM Eastern.

create or replace function public.georgia_today()
returns date
language sql
stable
as $$
  select (timezone('America/New_York', now()))::date;
$$;

revoke all on function public.georgia_today() from public, anon, authenticated, service_role;

create or replace function public.document_is_current(expires date)
returns boolean
language sql
stable
as $$
  select expires is not null and expires >= public.georgia_today();
$$;

revoke all on function public.document_is_current(date) from public, anon, authenticated, service_role;

create or replace function public.set_driver_online(go_online boolean)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  driver_row public.drivers%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into driver_row from public.drivers where profile_id = uid;
  if not found then
    raise exception 'driver profile not found';
  end if;

  if go_online then
    if driver_row.status not in ('active', 'approved_new') then
      raise exception 'Finish these steps. You can go Online after Pickuply approves you.';
    end if;
    if driver_row.license_url is null or driver_row.license_expires is null then
      raise exception 'Add your driver license before going Online.';
    end if;
    if driver_row.license_expires < public.georgia_today() then
      raise exception 'Your license expired on % - upload a new photo to go Online.',
        to_char(driver_row.license_expires, 'FMMM/FMDD/YYYY');
    end if;
    if driver_row.insurance_expires is not null and driver_row.insurance_expires < public.georgia_today() then
      raise exception 'Your insurance expired on % - upload a new card to go Online.',
        to_char(driver_row.insurance_expires, 'FMMM/FMDD/YYYY');
    end if;
    if driver_row.terms_version is distinct from 'driver-terms-v1' then
      raise exception 'Accept the Driver Terms to go Online.';
    end if;
  end if;

  perform set_config('pickuply.driver_online', 'yes', true);
  update public.drivers
  set
    is_online = go_online,
    first_online_at = case
      when go_online then coalesce(first_online_at, now())
      else first_online_at
    end
  where profile_id = uid;
end;
$function$;

create or replace function public.save_driver_license(doc_path text, expires date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current_path text;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select license_url into current_path from public.drivers where profile_id = uid;
  if coalesce(doc_path, '') = '' then
    doc_path := current_path;
  end if;
  if coalesce(doc_path, '') !~ ('^' || uid::text || '/license\.(jpg|jpeg|png|webp)$') then
    raise exception 'upload a photo of your driver license';
  end if;
  if expires is null or expires < public.georgia_today() then
    raise exception 'your license expiration must be in the future';
  end if;
  perform set_config('pickuply.driver_checklist', 'yes', true);
  update public.drivers
  set license_url = doc_path, license_expires = expires
  where profile_id = uid and status <> 'removed';
  if not found then
    raise exception 'submit an application first';
  end if;
  perform public.clear_driver_item_note(uid, 'license');
end;
$$;

create or replace function public.save_driver_insurance(doc_path text, expires date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current_path text;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select insurance_url into current_path from public.drivers where profile_id = uid;
  if coalesce(doc_path, '') = '' then
    doc_path := current_path;
  end if;
  if coalesce(doc_path, '') !~ ('^' || uid::text || '/insurance\.(jpg|jpeg|png|webp)$') then
    raise exception 'upload a photo of your insurance';
  end if;
  if expires is null or expires < public.georgia_today() then
    raise exception 'your insurance expiration must be in the future';
  end if;
  perform set_config('pickuply.driver_checklist', 'yes', true);
  update public.drivers
  set insurance_url = doc_path, insurance_expires = expires
  where profile_id = uid and status <> 'removed';
  if not found then
    raise exception 'submit an application first';
  end if;
  perform public.clear_driver_item_note(uid, 'insurance');
end;
$$;

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
  if (payload->>'license_expires')::date < public.georgia_today() then
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
      (payload->>'service_level')::public.service_level,
      case
        when payload->>'vehicle_type' in ('car', 'suv') then array['delivery', 'construction']::public.job_service[]
        else array['delivery', 'junk', 'construction']::public.job_service[]
      end,
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
