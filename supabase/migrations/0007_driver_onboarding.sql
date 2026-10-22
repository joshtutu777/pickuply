-- Driver applications, private documents, and admin review.
-- Applicants stay role customer until an admin approves them.
-- Do not apply this file to the hosted project until the owner approves.

alter table public.drivers
  add column agreement_signature text,
  add column agreement_version text,
  add column review_note text;

-- The applicant can submit pending_review. Later approval fields stay with admin.
create or replace function public.guard_drivers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() or public.is_migration_session() then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.profile_id is distinct from auth.uid()
      or new.status not in ('applied', 'pending_review') then
      raise exception 'a driver application starts as pending review';
    end if;
  else
    if new.status is distinct from old.status then
      if current_setting('pickuply.driver_application', true) = 'yes'
        and new.status = 'pending_review'
        and old.status in ('applied', 'pending_review', 'removed') then
        null;
      else
        raise exception 'only an admin can change driver status';
      end if;
    end if;
    if new.status not in ('applied', 'pending_review')
      and (
        new.service_level is distinct from old.service_level
        or new.zone_id is distinct from old.zone_id
        or new.services is distinct from old.services
      ) then
      raise exception 'only an admin can change driver approval fields';
    end if;
    if new.is_online is distinct from old.is_online
      and current_setting('pickuply.driver_online', true) is distinct from 'yes' then
      raise exception 'use the online switch';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

insert into storage.buckets (id, name, public)
values ('driver-docs', 'driver-docs', false)
on conflict (id) do update set public = false;

create policy driver_docs_bucket_read on storage.buckets
  for select to authenticated
  using (id = 'driver-docs');

-- The owner can store their own documents. Admin can read them. The bucket stays private.
create policy driver_docs_owner_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'driver-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'driver-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy driver_docs_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'driver-docs' and public.is_admin());

create or replace function public.submit_driver_application(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  applicant_name text;
  zone uuid;
  miles numeric;
  services public.job_service[];
  equipment text[];
  vehicle_id uuid;
  existing public.drivers%rowtype;
  driver_exists boolean := false;
  signature text;
  agreements text[];
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'application details are required';
  end if;

  applicant_name := btrim(coalesce(payload->>'full_name', ''));
  if applicant_name !~ '^[A-Za-z][A-Za-z .''-]{1,79}$' then
    raise exception 'enter your full name';
  end if;
  signature := btrim(coalesce(payload->>'signature', ''));
  if lower(signature) is distinct from lower(applicant_name) then
    raise exception 'type your full name to sign';
  end if;

  select coalesce(array_agg(value), '{}')
  into agreements
  from jsonb_array_elements_text(coalesce(payload->'agreements', '[]'::jsonb)) as value;
  if not (
    'accurate' = any (agreements)
    and 'independent' = any (agreements)
    and 'rules' = any (agreements)
    and 'payout' = any (agreements)
  ) then
    raise exception 'agree to each driver rule before submitting';
  end if;

  zone := (payload->>'zone_id')::uuid;
  if not exists (select 1 from public.zones where id = zone and active) then
    raise exception 'choose a service area';
  end if;
  miles := (payload->>'max_distance_miles')::numeric;
  if miles is null or miles <= 0 or miles > 100 then
    raise exception 'choose how far you will drive';
  end if;

  select coalesce(array_agg(value::public.job_service), '{}')
  into services
  from jsonb_array_elements_text(coalesce(payload->'services', '[]'::jsonb)) as value;
  if cardinality(services) < 1 then
    raise exception 'choose at least one service';
  end if;

  select coalesce(array_agg(value), '{}')
  into equipment
  from jsonb_array_elements_text(coalesce(payload->'equipment', '[]'::jsonb)) as value;

  if coalesce(payload->>'license_path', '') !~ (
    '^' || uid::text || '/license\.(jpg|jpeg|png|webp)$'
  ) then
    raise exception 'upload a photo of your driver license';
  end if;
  if coalesce(payload->>'photo_path', '') !~ (
    '^' || uid::text || '/profile\.(jpg|jpeg|png|webp)$'
  ) then
    raise exception 'upload a profile photo';
  end if;
  if coalesce(payload->>'vehicle_photo_path', '') !~ (
    '^' || uid::text || '/vehicle\.(jpg|jpeg|png|webp)$'
  ) then
    raise exception 'upload a photo of your vehicle';
  end if;
  if nullif(payload->>'insurance_path', '') is not null
    and payload->>'insurance_path' !~ (
      '^' || uid::text || '/insurance\.(jpg|jpeg|png|webp)$'
    ) then
    raise exception 'insurance file path is not valid';
  end if;
  if (payload->>'license_expires')::date < current_date then
    raise exception 'your license expiration must be in the future';
  end if;
  if nullif(payload->>'insurance_expires', '') is not null
    and (payload->>'insurance_expires')::date < current_date then
    raise exception 'your insurance expiration must be in the future';
  end if;
  if payload->>'payout_method' not in ('zelle', 'cash_app')
    or length(btrim(coalesce(payload->>'payout_handle', ''))) < 3 then
    raise exception 'add a Zelle or Cash App handle';
  end if;
  if payload->>'service_level' not in ('light', 'full') then
    raise exception 'choose a service level';
  end if;
  if payload->>'vehicle_type' not in ('car', 'suv', 'pickup', 'van', 'box_truck', 'trailer') then
    raise exception 'choose a vehicle type';
  end if;
  if length(btrim(coalesce(payload->>'home_city', ''))) < 2 then
    raise exception 'enter your home city';
  end if;
  if length(btrim(coalesce(payload->>'make', ''))) < 1
    or length(btrim(coalesce(payload->>'model', ''))) < 1
    or length(btrim(coalesce(payload->>'plate', ''))) < 2 then
    raise exception 'enter the vehicle make, model, and plate';
  end if;
  if (payload->>'year')::integer < 1990 or (payload->>'year')::integer > 2027 then
    raise exception 'enter a vehicle year';
  end if;
  if (payload->>'cargo_length_in')::integer < 1 then
    raise exception 'enter the cargo length';
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
      profile_id, status, zone_id, home_city, max_distance_miles, service_level,
      services, equipment, helper_name, helper_phone, license_url, license_expires,
      insurance_url, insurance_expires, payout_method, payout_handle,
      agreement_signed_at, agreement_signature, agreement_version, review_note, is_online
    ) values (
      uid, 'pending_review', zone, btrim(payload->>'home_city'), miles,
      (payload->>'service_level')::public.service_level, services, equipment,
      nullif(btrim(coalesce(payload->>'helper_name', '')), ''),
      nullif(btrim(coalesce(payload->>'helper_phone', '')), ''),
      payload->>'license_path', (payload->>'license_expires')::date,
      nullif(payload->>'insurance_path', ''),
      nullif(payload->>'insurance_expires', '')::date,
      payload->>'payout_method', btrim(payload->>'payout_handle'),
      now(), signature, '2026-10', null, false
    );
  else
    update public.drivers
    set
      status = 'pending_review',
      zone_id = zone,
      home_city = btrim(payload->>'home_city'),
      max_distance_miles = miles,
      service_level = (payload->>'service_level')::public.service_level,
      services = services,
      equipment = equipment,
      helper_name = nullif(btrim(coalesce(payload->>'helper_name', '')), ''),
      helper_phone = nullif(btrim(coalesce(payload->>'helper_phone', '')), ''),
      license_url = payload->>'license_path',
      license_expires = (payload->>'license_expires')::date,
      insurance_url = nullif(payload->>'insurance_path', ''),
      insurance_expires = nullif(payload->>'insurance_expires', '')::date,
      payout_method = payload->>'payout_method',
      payout_handle = btrim(payload->>'payout_handle'),
      agreement_signed_at = now(),
      agreement_signature = signature,
      agreement_version = '2026-10',
      review_note = null,
      is_online = false
    where profile_id = uid;
  end if;

  select id into vehicle_id
  from public.vehicles
  where driver_id = uid
  order by created_at desc
  limit 1;

  if vehicle_id is null then
    insert into public.vehicles (
      driver_id, type, make, model, year, plate, cargo_length_in, photo_url, approved
    ) values (
      uid,
      (payload->>'vehicle_type')::public.vehicle_type,
      btrim(payload->>'make'),
      btrim(payload->>'model'),
      (payload->>'year')::integer,
      upper(btrim(payload->>'plate')),
      (payload->>'cargo_length_in')::integer,
      payload->>'vehicle_photo_path',
      false
    );
  else
    update public.vehicles
    set
      type = (payload->>'vehicle_type')::public.vehicle_type,
      make = btrim(payload->>'make'),
      model = btrim(payload->>'model'),
      year = (payload->>'year')::integer,
      plate = upper(btrim(payload->>'plate')),
      cargo_length_in = (payload->>'cargo_length_in')::integer,
      photo_url = payload->>'vehicle_photo_path'
    where id = vehicle_id and driver_id = uid;
  end if;
end;
$function$;

revoke all on function public.submit_driver_application(jsonb) from public;
revoke all on function public.submit_driver_application(jsonb) from anon;
revoke all on function public.submit_driver_application(jsonb) from service_role;
grant execute on function public.submit_driver_application(jsonb) to authenticated;

create or replace function public.review_driver(
  target_driver uuid,
  decision text,
  note text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  driver_row public.drivers%rowtype;
  next_status public.driver_status;
  next_role public.profile_role;
begin
  if not public.is_admin() then
    raise exception 'only an admin can review drivers';
  end if;
  if decision not in (
    'approve_new', 'approve_active', 'request_changes', 'decline', 'pause', 'remove'
  ) then
    raise exception 'choose a review decision';
  end if;
  if decision in ('request_changes', 'decline', 'pause', 'remove')
    and length(btrim(coalesce(note, ''))) < 3 then
    raise exception 'add a short note for the driver';
  end if;

  select * into driver_row from public.drivers where profile_id = target_driver for update;
  if not found then
    raise exception 'driver application not found';
  end if;

  if decision in ('approve_new', 'approve_active') then
    if driver_row.license_url is null or driver_row.license_expires is null then
      raise exception 'license is required before approval';
    end if;
    if not exists (select 1 from public.vehicles where driver_id = target_driver) then
      raise exception 'a vehicle is required before approval';
    end if;
  end if;

  next_role := case
    when decision in ('approve_new', 'approve_active') then 'driver'::public.profile_role
    when decision in ('decline', 'remove') then 'customer'::public.profile_role
    else null
  end;
  next_status := case decision
    when 'approve_new' then 'approved_new'::public.driver_status
    when 'approve_active' then 'active'::public.driver_status
    when 'request_changes' then 'pending_review'::public.driver_status
    when 'decline' then 'removed'::public.driver_status
    when 'pause' then 'paused'::public.driver_status
    else 'removed'::public.driver_status
  end;

  update public.drivers
  set
    status = next_status,
    review_note = nullif(btrim(coalesce(note, '')), ''),
    is_online = case
      when decision in ('approve_new', 'approve_active', 'request_changes') then false
      else false
    end
  where profile_id = target_driver;

  if decision in ('approve_new', 'approve_active') then
    update public.vehicles set approved = true where driver_id = target_driver;
  end if;

  if next_role is not null then
    update public.profiles set role = next_role where id = target_driver;
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'review_driver',
    'driver',
    target_driver,
    jsonb_build_object('decision', decision, 'note', nullif(btrim(coalesce(note, '')), ''))
  );
end;
$function$;

revoke all on function public.review_driver(uuid, text, text) from public;
revoke all on function public.review_driver(uuid, text, text) from anon;
revoke all on function public.review_driver(uuid, text, text) from service_role;
grant execute on function public.review_driver(uuid, text, text) to authenticated;

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
      raise exception 'your driver account is not approved';
    end if;
    if driver_row.license_expires is null or driver_row.license_expires < current_date then
      raise exception 'add an unexpired driver license';
    end if;
    if driver_row.insurance_expires is null or driver_row.insurance_expires < current_date
      or driver_row.insurance_url is null then
      raise exception 'add unexpired insurance before going online';
    end if;
    if not exists (
      select 1 from public.vehicles where driver_id = uid and approved
    ) then
      raise exception 'an approved vehicle is required before going online';
    end if;
  end if;

  perform set_config('pickuply.driver_online', 'yes', true);
  update public.drivers set is_online = go_online where profile_id = uid;
end;
$function$;

revoke all on function public.set_driver_online(boolean) from public;
revoke all on function public.set_driver_online(boolean) from anon;
revoke all on function public.set_driver_online(boolean) from service_role;
grant execute on function public.set_driver_online(boolean) to authenticated;
