-- Separate first and last names. Existing full_name values stay as they are.
-- A last name is filled only when the stored name is exactly two reliable words.
-- One word or three-plus words never invent a last name, and saved parts are not overwritten.

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

alter table public.profiles
  drop constraint if exists profiles_first_name_length,
  drop constraint if exists profiles_last_name_length;

alter table public.profiles
  add constraint profiles_first_name_length check (first_name is null or char_length(first_name) between 1 and 40),
  add constraint profiles_last_name_length check (last_name is null or char_length(last_name) between 1 and 40);

comment on column public.profiles.first_name is 'Given name. Null until a reliable name is known.';
comment on column public.profiles.last_name is 'Family name. Null when it cannot be determined. Never a placeholder.';

create or replace function public.name_part_ok(raw text)
returns text
language plpgsql
immutable
as $$
declare
  cleaned text := nullif(regexp_replace(btrim(coalesce(raw, '')), '[[:space:]]+', ' ', 'g'), '');
begin
  if cleaned is null then
    return null;
  end if;
  if char_length(cleaned) > 40 then
    return null;
  end if;
  if cleaned !~ '[[:alpha:]]' then
    return null;
  end if;
  if cleaned ~ '[^[:alpha:][:space:].''’-]' then
    return null;
  end if;
  return cleaned;
end;
$$;

revoke all on function public.name_part_ok(text) from public;

create or replace function public.backfill_profile_names()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles as profile
  set
    first_name = case
      when profile.first_name is not null then profile.first_name
      when cardinality(parsed.tokens) = 2
        and public.name_part_ok(parsed.tokens[1]) is not null
        and public.name_part_ok(parsed.tokens[2]) is not null
        then public.name_part_ok(parsed.tokens[1])
      when cardinality(parsed.tokens) = 1 then public.name_part_ok(parsed.tokens[1])
      when cardinality(parsed.tokens) >= 3 then public.name_part_ok(parsed.tokens[1])
      else profile.first_name
    end,
    last_name = case
      when profile.last_name is not null then profile.last_name
      when cardinality(parsed.tokens) = 2
        and public.name_part_ok(parsed.tokens[1]) is not null
        and public.name_part_ok(parsed.tokens[2]) is not null
        then public.name_part_ok(parsed.tokens[2])
      else profile.last_name
    end
  from (
    select
      id,
      regexp_split_to_array(regexp_replace(btrim(full_name), '[[:space:]]+', ' ', 'g'), ' ') as tokens
    from public.profiles
    where full_name is not null and btrim(full_name) <> ''
  ) as parsed
  where profile.id = parsed.id
    and (profile.first_name is null or profile.last_name is null);
end;
$$;

revoke all on function public.backfill_profile_names() from public;

alter table public.profiles disable trigger profiles_guard_role;
select public.backfill_profile_names();
alter table public.profiles enable trigger profiles_guard_role;

create or replace function public.save_profile_names(next_first text, next_last text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_first text := public.name_part_ok(next_first);
  cleaned_last text := public.name_part_ok(next_last);
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  if cleaned_first is null or cleaned_last is null then
    raise exception 'enter your first and last name';
  end if;
  update public.profiles
  set
    first_name = cleaned_first,
    last_name = cleaned_last,
    full_name = cleaned_first || ' ' || cleaned_last
  where id = auth.uid();
  if not found then
    raise exception 'profile not found';
  end if;
end;
$$;

revoke all on function public.save_profile_names(text, text) from public, anon;
grant execute on function public.save_profile_names(text, text) to authenticated;

create or replace function public.submit_quick_application(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  applicant_name text;
  applicant_first text;
  applicant_last text;
  legacy_name text;
  legacy_tokens text[];
  zone uuid;
  existing public.drivers%rowtype;
  driver_exists boolean := false;
  zip_value text := nullif(btrim(coalesce(payload->>'home_zip', '')), '');
  applicant_email text;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  applicant_first := public.name_part_ok(payload->>'first_name');
  applicant_last := public.name_part_ok(payload->>'last_name');
  if applicant_first is null or applicant_last is null then
    legacy_name := regexp_replace(btrim(coalesce(payload->>'full_name', '')), '[[:space:]]+', ' ', 'g');
    legacy_tokens := regexp_split_to_array(legacy_name, ' ');
    if cardinality(legacy_tokens) = 2 then
      applicant_first := public.name_part_ok(legacy_tokens[1]);
      applicant_last := public.name_part_ok(legacy_tokens[2]);
    end if;
  end if;
  if applicant_first is null or applicant_last is null then
    raise exception 'enter your first and last name';
  end if;
  applicant_name := applicant_first || ' ' || applicant_last;
  if coalesce(payload->>'contact_ok', '') <> 'true' then
    raise exception 'agree to be contacted about this application';
  end if;
  if coalesce(payload->>'terms_ok', '') <> 'true' then
    raise exception 'agree to the driver terms';
  end if;
  applicant_email := btrim(coalesce(payload->>'email', ''));
  if applicant_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' or char_length(applicant_email) > 200 then
    raise exception 'enter your email';
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
  set
    first_name = applicant_first,
    last_name = applicant_last,
    full_name = applicant_name,
    photo_url = payload->>'photo_path',
    email = applicant_email
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
      true, now(), null, false, 'driver-terms-v2', now(), now()
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
      terms_version = 'driver-terms-v2',
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
