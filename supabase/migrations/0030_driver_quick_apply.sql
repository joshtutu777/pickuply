-- A short driver application. Approval alone does not allow Online, claims,
-- offers, or invited jobs until the checklist is finished.

alter table public.drivers
  add column checklist_required boolean not null default false,
  add column training_completed_at timestamptz,
  add column contact_consent_at timestamptz,
  add column kit_saved_at timestamptz;

create or replace function public.guard_drivers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_migration_session() then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if public.is_admin()
      and coalesce(current_setting('pickuply.driver_review', true), '') = 'yes' then
      null;
    elsif not public.is_admin()
      and coalesce(current_setting('pickuply.driver_application', true), '') = 'yes'
      and new.status = 'pending_review'
      and old.status in ('applied', 'pending_review', 'removed') then
      null;
    else
      raise exception 'only an admin can change driver status';
    end if;
  end if;

  if public.is_admin() then
    new.updated_at := now();
    return new;
  end if;

  if current_setting('pickuply.driver_checklist', true) = 'yes'
    and tg_op = 'UPDATE'
    and new.profile_id = auth.uid()
    and new.status is not distinct from old.status
    and new.is_online is not distinct from old.is_online
  then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.profile_id is distinct from auth.uid()
      or new.status not in ('applied', 'pending_review') then
      raise exception 'a driver application starts as pending review';
    end if;
  else
    if new.status not in ('applied', 'pending_review')
      and (
        new.service_level is distinct from old.service_level
        or new.zone_id is distinct from old.zone_id
        or new.services is distinct from old.services
        or new.license_expires is distinct from old.license_expires
        or new.insurance_expires is distinct from old.insurance_expires
      ) then
      raise exception 'only an admin can change driver approval fields';
    end if;
    if new.is_online is distinct from old.is_online
      and coalesce(current_setting('pickuply.driver_online', true), '') is distinct from 'yes' then
      raise exception 'use the online switch';
    end if;
  end if;

  new.updated_at := now();
  return new;
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
  zone := (payload->>'zone_id')::uuid;
  if not exists (select 1 from public.zones where id = zone and active) then
    raise exception 'choose a service area';
  end if;
  if length(btrim(coalesce(payload->>'home_city', ''))) < 2 then
    raise exception 'enter your home city';
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
      profile_id, status, zone_id, home_city, max_distance_miles, service_level,
      services, license_url, license_expires, checklist_required, contact_consent_at,
      review_note, is_online
    ) values (
      uid, 'pending_review', zone, btrim(payload->>'home_city'), 25,
      (payload->>'service_level')::public.service_level, '{}',
      payload->>'license_path', (payload->>'license_expires')::date,
      true, now(), null, false
    );
  else
    update public.drivers
    set
      status = 'pending_review',
      zone_id = zone,
      home_city = btrim(payload->>'home_city'),
      service_level = (payload->>'service_level')::public.service_level,
      license_url = payload->>'license_path',
      license_expires = (payload->>'license_expires')::date,
      checklist_required = true,
      contact_consent_at = now(),
      review_note = null,
      is_online = false
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
end;
$$;

revoke all on function public.submit_quick_application(jsonb) from public, anon, service_role;
grant execute on function public.submit_quick_application(jsonb) to authenticated;

create or replace function public.save_driver_insurance(doc_path text, expires date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if coalesce(doc_path, '') !~ ('^' || uid::text || '/insurance\.(jpg|jpeg|png|webp)$') then
    raise exception 'upload a photo of your insurance';
  end if;
  if expires is null or expires < current_date then
    raise exception 'your insurance expiration must be in the future';
  end if;
  perform set_config('pickuply.driver_checklist', 'yes', true);
  update public.drivers
  set insurance_url = doc_path, insurance_expires = expires
  where profile_id = uid and status <> 'removed';
  if not found then
    raise exception 'submit an application first';
  end if;
end;
$$;

revoke all on function public.save_driver_insurance(text, date) from public, anon, service_role;
grant execute on function public.save_driver_insurance(text, date) to authenticated;

create or replace function public.save_driver_vehicle(
  make text,
  model text,
  vehicle_year integer,
  plate text,
  cargo_length integer,
  photo_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  vehicle_id uuid;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if length(btrim(coalesce(make, ''))) < 1
    or length(btrim(coalesce(model, ''))) < 1
    or length(btrim(coalesce(plate, ''))) < 2 then
    raise exception 'enter the vehicle make, model, and plate';
  end if;
  if vehicle_year < 1990 or vehicle_year > extract(year from current_date)::integer + 1 then
    raise exception 'enter a vehicle year';
  end if;
  if cargo_length < 1 then
    raise exception 'enter the cargo length';
  end if;
  if coalesce(photo_path, '') !~ ('^' || uid::text || '/vehicle\.(jpg|jpeg|png|webp)$') then
    raise exception 'upload a photo of your vehicle';
  end if;
  select id into vehicle_id
  from public.vehicles
  where driver_id = uid
  order by created_at desc
  limit 1;
  if vehicle_id is null then
    raise exception 'submit an application first';
  end if;
  update public.vehicles
  set
    make = btrim(save_driver_vehicle.make),
    model = btrim(save_driver_vehicle.model),
    year = vehicle_year,
    plate = upper(btrim(save_driver_vehicle.plate)),
    cargo_length_in = cargo_length,
    photo_url = photo_path
  where id = vehicle_id and driver_id = uid and approved = false;
  if not found then
    raise exception 'ask an admin before changing an approved vehicle';
  end if;
end;
$$;

revoke all on function public.save_driver_vehicle(text, text, integer, text, integer, text) from public, anon, service_role;
grant execute on function public.save_driver_vehicle(text, text, integer, text, integer, text) to authenticated;

create or replace function public.save_driver_kit(
  chosen_equipment text[],
  helper text,
  helper_phone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  clean text[];
  phone text := nullif(btrim(coalesce(helper_phone, '')), '');
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select coalesce(array_agg(distinct item), '{}')
  into clean
  from unnest(coalesce(chosen_equipment, array[]::text[])) as item
  where item in ('blankets', 'straps', 'dolly', 'ramp');
  if phone is not null and phone !~ '^\+1[0-9]{10}$' then
    raise exception 'enter the helper phone as +1 and 10 digits';
  end if;
  perform set_config('pickuply.driver_checklist', 'yes', true);
  update public.drivers
  set equipment = clean,
      helper_name = nullif(btrim(coalesce(helper, '')), ''),
      helper_phone = phone,
      kit_saved_at = now()
  where profile_id = uid and status <> 'removed';
  if not found then
    raise exception 'submit an application first';
  end if;
end;
$$;

revoke all on function public.save_driver_kit(text[], text, text) from public, anon, service_role;
grant execute on function public.save_driver_kit(text[], text, text) to authenticated;

create or replace function public.save_driver_services(chosen text[], level text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  clean public.job_service[];
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if level not in ('light', 'full') then
    raise exception 'choose light load or full service';
  end if;
  select coalesce(array_agg(distinct item::public.job_service), '{}')
  into clean
  from unnest(coalesce(chosen, array[]::text[])) as item
  where item in ('delivery', 'junk', 'free_item', 'construction');
  if cardinality(clean) < 1 then
    raise exception 'choose at least one service';
  end if;
  perform set_config('pickuply.driver_checklist', 'yes', true);
  update public.drivers
  set services = clean, service_level = level::public.service_level
  where profile_id = uid and status <> 'removed';
  if not found then
    raise exception 'submit an application first';
  end if;
end;
$$;

revoke all on function public.save_driver_services(text[], text) from public, anon, service_role;
grant execute on function public.save_driver_services(text[], text) to authenticated;

create or replace function public.sign_driver_agreement(signature text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  applicant_name text;
  signed text := btrim(coalesce(signature, ''));
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select full_name into applicant_name from public.profiles where id = uid;
  if applicant_name is null or lower(signed) is distinct from lower(applicant_name) then
    raise exception 'type your full name to sign';
  end if;
  perform set_config('pickuply.driver_checklist', 'yes', true);
  update public.drivers
  set agreement_signed_at = now(), agreement_signature = signed, agreement_version = '2026-10'
  where profile_id = uid and status <> 'removed';
  if not found then
    raise exception 'submit an application first';
  end if;
end;
$$;

revoke all on function public.sign_driver_agreement(text) from public, anon, service_role;
grant execute on function public.sign_driver_agreement(text) to authenticated;

create or replace function public.complete_driver_training()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  perform set_config('pickuply.driver_checklist', 'yes', true);
  update public.drivers
  set training_completed_at = now()
  where profile_id = uid and status <> 'removed';
  if not found then
    raise exception 'submit an application first';
  end if;
end;
$$;

revoke all on function public.complete_driver_training() from public, anon, service_role;
grant execute on function public.complete_driver_training() to authenticated;

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
    if driver_row.checklist_required and driver_row.agreement_signed_at is null then
      raise exception 'sign the driver agreement before going online';
    end if;
    if driver_row.checklist_required and driver_row.training_completed_at is null then
      raise exception 'finish the short training before going online';
    end if;
    if driver_row.checklist_required and cardinality(driver_row.services) < 1 then
      raise exception 'choose the services you offer before going online';
    end if;
  end if;

  perform set_config('pickuply.driver_online', 'yes', true);
  update public.drivers set is_online = go_online where profile_id = uid;
end;
$function$;

create or replace function public.driver_is_eligible_for_job(target_job uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  profile_row public.profiles%rowtype;
  driver_row public.drivers%rowtype;
  job_row public.jobs%rowtype;
  private_row public.job_private%rowtype;
  miles numeric;
begin
  if uid is null then
    return false;
  end if;

  select * into profile_row from public.profiles where id = uid;
  if not found or profile_row.role <> 'driver' or profile_row.blocked then
    return false;
  end if;

  select * into driver_row from public.drivers where profile_id = uid;
  if not found or driver_row.status not in ('active', 'approved_new') then
    return false;
  end if;

  if driver_row.checklist_required and (
    driver_row.license_url is null
    or driver_row.license_expires is null
    or driver_row.license_expires < current_date
    or driver_row.insurance_url is null
    or driver_row.insurance_expires is null
    or driver_row.insurance_expires < current_date
    or driver_row.agreement_signed_at is null
    or driver_row.training_completed_at is null
    or cardinality(driver_row.services) < 1
  ) then
    return false;
  end if;

  select * into job_row from public.jobs where id = target_job;
  if not found or job_row.status <> 'open' then
    return false;
  end if;

  if job_row.zone_id is null or driver_row.zone_id is distinct from job_row.zone_id then
    return false;
  end if;
  if job_row.service_level is null or job_row.required_vehicle is null then
    return false;
  end if;
  if not (job_row.service = any (driver_row.services)) then
    return false;
  end if;
  if job_row.service_level = 'full' and driver_row.service_level <> 'full' then
    return false;
  end if;
  if not exists (
    select 1
    from public.vehicles
    where driver_id = uid
      and approved
      and type = job_row.required_vehicle
  ) then
    return false;
  end if;
  if exists (
    select 1
    from public.customer_driver_blocks
    where customer_id = job_row.customer_id
      and driver_id = uid
  ) then
    return false;
  end if;
  if driver_row.status = 'approved_new' and not exists (
    select 1
    from public.job_driver_invitations
    where job_id = job_row.id
      and driver_id = uid
  ) then
    return false;
  end if;

  select * into private_row from public.job_private where job_id = job_row.id;
  if found and private_row.pickup_lat is not null and private_row.pickup_lng is not null then
    if driver_row.max_distance_miles is null or driver_row.last_lat is null or driver_row.last_lng is null then
      return false;
    end if;
    miles := public.private_miles_between(
      driver_row.last_lat,
      driver_row.last_lng,
      private_row.pickup_lat,
      private_row.pickup_lng
    );
    if miles is null or miles > driver_row.max_distance_miles then
      return false;
    end if;
  end if;

  return true;
end;
$$;

-- A quick application can be approved before the vehicle photo and details exist.
-- Those vehicles stay unapproved until an admin approves them on their own.
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

  perform set_config('pickuply.driver_review', 'yes', true);
  update public.drivers
  set
    status = next_status,
    review_note = nullif(btrim(coalesce(note, '')), ''),
    is_online = false
  where profile_id = target_driver;

  if decision in ('approve_new', 'approve_active') and not driver_row.checklist_required then
    perform set_config('pickuply.vehicle_approval', 'yes', true);
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

create or replace function public.approve_driver_vehicle(target_driver uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_id uuid;
begin
  if not public.is_admin() then
    raise exception 'only an admin can approve a vehicle';
  end if;
  select id into vehicle_id
  from public.vehicles
  where driver_id = target_driver
    and make is not null
    and model is not null
    and photo_url is not null
  order by created_at desc
  limit 1;
  if vehicle_id is null then
    raise exception 'vehicle details and a photo are required';
  end if;
  perform set_config('pickuply.vehicle_approval', 'yes', true);
  update public.vehicles set approved = true where id = vehicle_id;
end;
$$;

revoke all on function public.approve_driver_vehicle(uuid) from public, anon, service_role;
grant execute on function public.approve_driver_vehicle(uuid) to authenticated;
