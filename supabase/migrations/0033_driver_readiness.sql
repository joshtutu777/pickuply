-- Checklist items share the rows Quick Apply already writes.
-- Going Online checks an active driver, an unexpired license, an unexpired
-- insurance card, and a signed agreement. It does not turn anyone Online,
-- and it does not require a separate vehicle approval or Stripe payouts.
-- Local only until the owner applies it to the hosted database.

create table public.driver_item_reviews (
  driver_id uuid not null references public.drivers (profile_id) on delete cascade,
  item text not null,
  note text,
  updated_at timestamptz not null default now(),
  primary key (driver_id, item),
  constraint driver_item_reviews_item check (
    item in ('license', 'services', 'vehicle', 'equipment', 'insurance', 'agreement', 'training')
  ),
  constraint driver_item_reviews_note check (note is null or char_length(btrim(note)) between 3 and 500)
);

alter table public.driver_item_reviews enable row level security;

-- A driver reads notes on their own checklist. An admin reads every note. Writes go through review functions.
create policy driver_item_reviews_select_own on public.driver_item_reviews
  for select to authenticated
  using (driver_id = auth.uid() or public.is_admin());

revoke all on table public.driver_item_reviews from public, anon, service_role;
grant select on table public.driver_item_reviews to authenticated;

create or replace function public.clear_driver_item_note(target uuid, item_name text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.driver_item_reviews
  where driver_id = target and item = item_name;
$$;

revoke all on function public.clear_driver_item_note(uuid, text) from public, anon, service_role;

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
  perform public.clear_driver_item_note(uid, 'insurance');
end;
$$;

drop function if exists public.save_driver_vehicle(text, text, integer, text, integer, text);

create or replace function public.save_driver_vehicle(
  make text,
  model text,
  vehicle_year integer,
  plate text,
  cargo_length integer,
  photo_path text,
  vehicle_type text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  vehicle_id uuid;
  current_photo text;
  next_type public.vehicle_type;
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
  select id, photo_url, type into vehicle_id, current_photo, next_type
  from public.vehicles
  where driver_id = uid
  order by created_at desc
  limit 1;
  if vehicle_id is null then
    raise exception 'submit an application first';
  end if;
  if coalesce(photo_path, '') = '' then
    photo_path := current_photo;
  end if;
  if coalesce(photo_path, '') <> '' and photo_path !~ ('^' || uid::text || '/vehicle\.(jpg|jpeg|png|webp)$') then
    raise exception 'upload a photo of your vehicle';
  end if;
  if coalesce(vehicle_type, '') <> '' then
    if vehicle_type not in ('car', 'suv', 'pickup', 'van', 'box_truck', 'trailer') then
      raise exception 'choose a vehicle type';
    end if;
    next_type := vehicle_type::public.vehicle_type;
  end if;
  update public.vehicles
  set
    type = next_type,
    make = btrim(save_driver_vehicle.make),
    model = btrim(save_driver_vehicle.model),
    year = vehicle_year,
    plate = upper(btrim(save_driver_vehicle.plate)),
    cargo_length_in = cargo_length,
    photo_url = nullif(photo_path, '')
  where id = vehicle_id and driver_id = uid;
  perform public.clear_driver_item_note(uid, 'vehicle');
end;
$$;

revoke all on function public.save_driver_vehicle(text, text, integer, text, integer, text, text) from public, anon, service_role;
grant execute on function public.save_driver_vehicle(text, text, integer, text, integer, text, text) to authenticated;

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
  if expires is null or expires < current_date then
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

revoke all on function public.save_driver_license(text, date) from public, anon, service_role;
grant execute on function public.save_driver_license(text, date) to authenticated;

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
  perform public.clear_driver_item_note(uid, 'equipment');
end;
$$;

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
  perform public.clear_driver_item_note(uid, 'services');
end;
$$;

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
  perform public.clear_driver_item_note(uid, 'agreement');
end;
$$;

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
  perform public.clear_driver_item_note(uid, 'training');
end;
$$;

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
    if driver_row.license_expires < current_date then
      raise exception 'Your license expired on % — upload a new photo to go Online.',
        to_char(driver_row.license_expires, 'FMMM/FMDD/YYYY');
    end if;
    if driver_row.insurance_url is null or driver_row.insurance_expires is null then
      raise exception 'Add your insurance card before going Online.';
    end if;
    if driver_row.insurance_expires < current_date then
      raise exception 'Your insurance expired on % — upload a new card to go Online.',
        to_char(driver_row.insurance_expires, 'FMMM/FMDD/YYYY');
    end if;
    if driver_row.agreement_signed_at is null then
      raise exception 'Sign the driver agreement before going Online.';
    end if;
  end if;

  perform set_config('pickuply.driver_online', 'yes', true);
  update public.drivers set is_online = go_online where profile_id = uid;
end;
$function$;

-- An admin puts a removed application back into review. The driver does not.
create or replace function public.reopen_driver_application(target_driver uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can reopen an application';
  end if;
  perform set_config('pickuply.driver_review', 'yes', true);
  update public.drivers
  set status = 'pending_review', review_note = null, is_online = false
  where profile_id = target_driver and status = 'removed';
  if not found then
    raise exception 'that application is not closed';
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (auth.uid(), 'reopen_driver_application', 'driver', target_driver, '{}'::jsonb);
end;
$$;

revoke all on function public.reopen_driver_application(uuid) from public, anon, service_role;
grant execute on function public.reopen_driver_application(uuid) to authenticated;

-- Local backfill: approved_new drivers were stuck on invite-only jobs.
insert into public.audit_log (actor_id, action, target_type, target_id, data)
select
  null,
  'backfill_approved_new_to_active',
  'driver',
  profile_id,
  jsonb_build_object('from', 'approved_new', 'is_online', false)
from public.drivers
where status = 'approved_new';

update public.drivers
set status = 'active', is_online = false
where status = 'approved_new';
