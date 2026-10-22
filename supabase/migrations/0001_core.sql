-- Pickuply core schema, Row Level Security, and driver discovery.
-- Do not apply this file to the hosted project until the owner approves.
-- Money is integer cents. There is no auto-booking column.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.profile_role as enum ('customer', 'driver', 'admin');
create type public.driver_status as enum (
  'applied', 'pending_review', 'approved_new', 'active', 'paused', 'removed'
);
create type public.service_level as enum ('light', 'full');
create type public.vehicle_type as enum ('car', 'suv', 'pickup', 'van', 'box_truck', 'trailer');
create type public.job_service as enum ('delivery', 'junk', 'free_item', 'construction');
create type public.job_status as enum (
  'requested', 'in_review', 'quoted', 'open', 'assigned', 'en_route', 'arrived',
  'item_check', 'in_transit', 'delivered', 'completed', 'cancelled', 'disputed'
);
create type public.pricing_method as enum ('quote', 'fixed', 'range');
create type public.item_size as enum ('small', 'medium', 'large', 'xl');
create type public.junk_load_size as enum ('single', 'quarter', 'half', 'full');
create type public.time_window as enum ('morning', 'afternoon', 'evening');
create type public.photo_stage as enum ('request', 'pickup', 'dropoff', 'dump_receipt', 'report');
create type public.offer_kind as enum ('accept', 'offer', 'counter');
create type public.offer_status as enum ('active', 'withdrawn', 'expired', 'chosen', 'declined');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.profile_role not null default 'customer',
  full_name text,
  phone text,
  email text,
  photo_url text,
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.zones (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.zones (slug, name)
values
  ('west_metro', 'West Metro'),
  ('east_gwinnett', 'East Gwinnett');

create table public.drivers (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  status public.driver_status not null default 'applied',
  zone_id uuid references public.zones (id),
  home_city text,
  max_distance_miles numeric(6, 2),
  service_level public.service_level not null default 'light',
  services public.job_service[] not null default '{}',
  equipment text[] not null default '{}',
  helper_name text,
  helper_phone text,
  license_url text,
  license_expires date,
  insurance_url text,
  insurance_expires date,
  payout_method text,
  payout_handle text,
  w9_received boolean not null default false,
  agreement_signed_at timestamptz,
  is_online boolean not null default false,
  last_lat double precision,
  last_lng double precision,
  new_driver_jobs_completed integer not null default 0,
  rating_avg numeric(3, 2),
  rating_count integer not null default 0,
  alert_prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drivers_payout_method check (payout_method is null or payout_method in ('zelle', 'cash_app')),
  constraint drivers_max_distance check (max_distance_miles is null or max_distance_miles > 0)
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers (profile_id) on delete cascade,
  type public.vehicle_type not null,
  make text,
  model text,
  year integer,
  plate text,
  cargo_length_in integer,
  photo_url text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create index vehicles_driver_id_idx on public.vehicles (driver_id);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id),
  service public.job_service not null,
  status public.job_status not null default 'requested',
  zone_id uuid references public.zones (id),
  pickup_area text not null,
  dropoff_area text,
  distance_miles numeric(8, 2),
  description text not null,
  pieces integer not null,
  size public.item_size not null,
  item_value_cents integer not null,
  needs_value_approval boolean not null default false,
  listing_url text,
  already_paid boolean,
  seller_holding boolean,
  wants_item_check boolean,
  stairs_pickup integer not null,
  stairs_dropoff integer,
  elevator boolean not null,
  help_loading boolean not null,
  junk_load_size public.junk_load_size,
  junk_materials text,
  junk_special_items jsonb,
  store_name text,
  store_order_number text,
  preferred_date text not null,
  time_window public.time_window,
  notes text,
  pricing_method public.pricing_method not null,
  offer_cents integer,
  budget_min_cents integer,
  budget_max_cents integer,
  service_level public.service_level,
  required_vehicle public.vehicle_type,
  price_cents integer,
  driver_pay_cents integer,
  platform_fee_cents integer,
  dump_fee_cents integer,
  quote_expires_at timestamptz,
  assigned_driver_id uuid references public.drivers (profile_id),
  accepted_offer_id uuid,
  stripe_payment_intent_id text,
  payment_status text,
  captured_cents integer,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_pieces check (pieces >= 1),
  constraint jobs_stairs check (stairs_pickup >= 0 and (stairs_dropoff is null or stairs_dropoff >= 0)),
  constraint jobs_item_value check (item_value_cents >= 0),
  constraint jobs_money_nonnegative check (
    (offer_cents is null or offer_cents >= 0)
    and (budget_min_cents is null or budget_min_cents >= 0)
    and (budget_max_cents is null or budget_max_cents >= 0)
    and (price_cents is null or price_cents >= 0)
    and (driver_pay_cents is null or driver_pay_cents >= 0)
    and (platform_fee_cents is null or platform_fee_cents >= 0)
    and (dump_fee_cents is null or dump_fee_cents >= 0)
    and (captured_cents is null or captured_cents >= 0)
  ),
  constraint jobs_payment_status check (
    payment_status is null or payment_status in ('none', 'authorized', 'captured', 'canceled')
  ),
  constraint jobs_source check (
    source is null or source in ('nextdoor', 'facebook', 'friend', 'landlord', 'other')
  ),
  -- Quote jobs store no customer amount. The admin price lives in the separate quote columns.
  constraint jobs_pricing_quote check (
    pricing_method <> 'quote'
    or (offer_cents is null and budget_min_cents is null and budget_max_cents is null)
  ),
  constraint jobs_pricing_fixed check (
    pricing_method <> 'fixed'
    or (offer_cents >= 3500 and budget_min_cents is null and budget_max_cents is null)
  ),
  constraint jobs_pricing_range check (
    pricing_method <> 'range'
    or (
      offer_cents is null
      and budget_min_cents >= 3500
      and budget_max_cents > budget_min_cents
    )
  )
);

create index jobs_customer_id_idx on public.jobs (customer_id);
create index jobs_status_zone_idx on public.jobs (status, zone_id);
create index jobs_assigned_driver_idx on public.jobs (assigned_driver_id);

create table public.job_private (
  job_id uuid primary key references public.jobs (id) on delete cascade,
  pickup_address text not null,
  dropoff_address text,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff_lat double precision,
  dropoff_lng double precision,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  access_notes text,
  created_at timestamptz not null default now()
);

create table public.job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  stage public.photo_stage not null,
  storage_path text not null unique,
  uploaded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index job_photos_job_id_idx on public.job_photos (job_id);

create table public.customer_driver_blocks (
  customer_id uuid not null references public.profiles (id) on delete cascade,
  driver_id uuid not null references public.drivers (profile_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (customer_id, driver_id)
);

create index customer_driver_blocks_driver_idx on public.customer_driver_blocks (driver_id);

-- An invitation lets an approved_new driver see one open job. It is not an assignment.
create table public.job_driver_invitations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  driver_id uuid not null references public.drivers (profile_id) on delete cascade,
  invited_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (job_id, driver_id)
);

create index job_driver_invitations_driver_idx on public.job_driver_invitations (driver_id);

create table public.job_offers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  driver_id uuid not null references public.drivers (profile_id),
  kind public.offer_kind not null,
  driver_amount_cents integer not null,
  platform_fee_cents integer not null default 0,
  customer_total_cents integer not null,
  reason text,
  outside_range boolean not null default false,
  available_at timestamptz,
  status public.offer_status not null default 'active',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint job_offers_amounts check (
    driver_amount_cents > 0
    and platform_fee_cents >= 0
    and customer_total_cents = driver_amount_cents + platform_fee_cents
  ),
  constraint job_offers_counter_reason check (
    kind <> 'counter' or coalesce(btrim(reason), '') <> ''
  )
);

create index job_offers_job_id_idx on public.job_offers (job_id);
create index job_offers_driver_id_idx on public.job_offers (driver_id);

alter table public.jobs
  add constraint jobs_accepted_offer_fk
  foreign key (accepted_offer_id) references public.job_offers (id);

create table public.job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index job_events_job_id_idx on public.job_events (job_id, created_at);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id),
  action text not null,
  target_type text,
  target_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_actor_idx on public.audit_log (actor_id, created_at);

-- ---------------------------------------------------------------------------
-- Helpers. security definer so policies can call them without recursive RLS.
-- session_user stays the login role inside these functions. current_user does not.
-- ---------------------------------------------------------------------------

create or replace function public.is_migration_session()
returns boolean
language sql
stable
as $$
  select session_user in ('postgres', 'supabase_admin') and auth.uid() is null;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and not blocked
  );
$$;

create or replace function public.is_assigned_driver(target_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.jobs
    where id = target_job
      and assigned_driver_id = auth.uid()
      and status in (
        'assigned', 'en_route', 'arrived', 'item_check', 'in_transit',
        'delivered', 'completed', 'disputed'
      )
  );
$$;

create or replace function public.can_set_quote_prices()
returns boolean
language sql
stable
as $$
  select public.is_admin() or public.is_migration_session();
$$;

-- Miles between two points. Used only inside discovery. Coordinates are never returned.
create or replace function public.private_miles_between(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
)
returns numeric
language sql
immutable
as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else (
      2 * 3958.8 * asin(
        sqrt(
          power(sin(radians(lat2 - lat1) / 2), 2)
          + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
        )
      )
    )::numeric
  end;
$$;

-- True only for the signed-in driver. There is no driver-id argument, so a caller cannot impersonate anyone.
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

-- The only driver discovery path. It checks the signed-in person again before it returns rows.
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

  select * into profile_row from public.profiles where id = uid;
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

-- Customer acceptance publishes a quote job. It does not assign a driver.
create or replace function public.accept_admin_quote(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;

  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from auth.uid() then
    raise exception 'only the customer can accept this quote';
  end if;
  if job_row.pricing_method <> 'quote' or job_row.status <> 'quoted' then
    raise exception 'this job is not waiting for quote acceptance';
  end if;
  if job_row.price_cents is null or job_row.driver_pay_cents is null then
    raise exception 'the admin quote is incomplete';
  end if;

  perform set_config('pickuply.quote_accepted', 'yes', true);
  update public.jobs
  set status = 'open', updated_at = now()
  where id = target_job;

  insert into public.job_events (job_id, actor_id, type, data)
  values (
    target_job,
    auth.uid(),
    'quote_accepted',
    jsonb_build_object('to', 'open')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, phone, email)
  values (new.id, 'customer', new.phone, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.role <> 'customer' and not public.is_migration_session() and not public.is_admin() then
    raise exception 'new profiles start as customers';
  end if;

  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    if auth.uid() is not null and auth.uid() = old.id and not public.is_admin() then
      raise exception 'users cannot change their own role';
    end if;
    if not public.is_admin() and not public.is_migration_session() then
      raise exception 'only an admin can change a role';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_guard_role
  before insert or update on public.profiles
  for each row execute function public.guard_profile_role();

-- A driver can apply, but only an admin can approve or change status.
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
    if new.profile_id is distinct from auth.uid() or new.status is distinct from 'applied' then
      raise exception 'a driver application starts as applied';
    end if;
  else
    if new.status is distinct from old.status
      or new.service_level is distinct from old.service_level
      or new.zone_id is distinct from old.zone_id
      or new.services is distinct from old.services then
      raise exception 'only an admin can change driver approval fields';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger drivers_guard
  before insert or update on public.drivers
  for each row execute function public.guard_drivers();

-- A driver can record a vehicle. Only an admin can mark it approved.
create or replace function public.guard_vehicles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() or public.is_migration_session() then
    return new;
  end if;
  if new.driver_id is distinct from auth.uid() then
    raise exception 'drivers can only manage their own vehicles';
  end if;
  if new.approved then
    raise exception 'only an admin can approve a vehicle';
  end if;
  if tg_op = 'UPDATE' and old.approved and not new.approved then
    raise exception 'only an admin can change vehicle approval';
  end if;
  return new;
end;
$$;

create trigger vehicles_guard
  before insert or update on public.vehicles
  for each row execute function public.guard_vehicles();

create or replace function public.guard_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not public.is_admin() and not public.is_migration_session() then
      if new.customer_id is distinct from auth.uid() then
        raise exception 'customers can only create their own jobs';
      end if;
      if new.status is distinct from 'requested' then
        raise exception 'new jobs start as requested';
      end if;
    end if;
  else
    if new.pricing_method is distinct from old.pricing_method
      or new.offer_cents is distinct from old.offer_cents
      or new.budget_min_cents is distinct from old.budget_min_cents
      or new.budget_max_cents is distinct from old.budget_max_cents then
      raise exception 'the customer pricing preference cannot be changed';
    end if;

    if old.pricing_method = 'quote'
      and old.status = 'quoted'
      and new.status = 'open'
      and current_setting('pickuply.quote_accepted', true) is distinct from 'yes' then
      raise exception 'a quote job is published only when the customer accepts it';
    end if;

    if new.status = 'assigned'
      and old.status is distinct from 'open'
      and old.status is distinct from 'assigned' then
      raise exception 'assignment only follows an open job';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if (
      new.price_cents is not null
      or new.driver_pay_cents is not null
      or new.platform_fee_cents is not null
      or new.dump_fee_cents is not null
      or new.quote_expires_at is not null
    ) and not public.can_set_quote_prices() then
      raise exception 'only an admin can set quote prices';
    end if;
  elsif (
    new.price_cents is distinct from old.price_cents
    or new.driver_pay_cents is distinct from old.driver_pay_cents
    or new.platform_fee_cents is distinct from old.platform_fee_cents
    or new.dump_fee_cents is distinct from old.dump_fee_cents
    or new.quote_expires_at is distinct from old.quote_expires_at
  ) and not public.can_set_quote_prices() then
    raise exception 'only an admin can change quote prices';
  end if;

  if tg_op = 'INSERT' and new.status = 'assigned' then
    raise exception 'assignment only follows an open job';
  end if;
  if tg_op = 'INSERT'
    and new.pricing_method = 'quote'
    and new.status = 'open'
    and current_setting('pickuply.quote_accepted', true) is distinct from 'yes' then
    raise exception 'a quote job is published only when the customer accepts it';
  end if;

  if new.status in ('requested', 'in_review', 'quoted', 'open') and new.assigned_driver_id is not null then
    raise exception 'assigned_driver_id is set only when a driver is assigned';
  end if;
  if new.status = 'assigned' and new.assigned_driver_id is null then
    raise exception 'an assigned job needs an assigned driver';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger jobs_guard
  before insert or update on public.jobs
  for each row execute function public.guard_jobs();

create or replace function public.log_job_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.job_events (job_id, actor_id, type, data)
    values (
      new.id,
      auth.uid(),
      'status',
      jsonb_build_object('from', null, 'to', new.status::text)
    );
  elsif new.status is distinct from old.status then
    insert into public.job_events (job_id, actor_id, type, data)
    values (
      new.id,
      auth.uid(),
      'status',
      jsonb_build_object('from', old.status::text, 'to', new.status::text)
    );
  end if;
  return new;
end;
$$;

create trigger jobs_log_status
  after insert or update of status on public.jobs
  for each row execute function public.log_job_status();

create or replace function public.guard_job_offers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
  driver_row public.drivers%rowtype;
  trusted boolean := public.is_migration_session();
begin
  if new.status = 'chosen' then
    raise exception 'choosing an offer requires the customer booking step';
  end if;

  select * into job_row from public.jobs where id = new.job_id;
  if not found then
    raise exception 'job not found';
  end if;
  if job_row.pricing_method = 'quote' then
    raise exception 'drivers cannot offer on a quote job';
  end if;

  if not trusted then
    if auth.uid() is null or new.driver_id is distinct from auth.uid() then
      raise exception 'only the signed-in driver can create this offer';
    end if;
    if job_row.status <> 'open' then
      raise exception 'offers are only allowed on open jobs';
    end if;
    select * into driver_row from public.drivers where profile_id = auth.uid();
    if not found or not driver_row.is_online then
      raise exception 'go online before sending an offer';
    end if;
    if not public.driver_is_eligible_for_job(new.job_id) then
      raise exception 'this driver cannot offer on this job';
    end if;
    if tg_op = 'INSERT' and new.status <> 'active' then
      raise exception 'a new offer starts as active';
    end if;
  end if;

  if job_row.pricing_method = 'fixed' then
    if new.kind = 'offer' then
      raise exception 'fixed jobs use accept or counter';
    end if;
    if new.kind = 'accept' and (new.driver_amount_cents is distinct from job_row.offer_cents or new.outside_range) then
      raise exception 'accepting a fixed price must match the customer price';
    end if;
    if new.kind = 'counter' and (new.driver_amount_cents = job_row.offer_cents or not new.outside_range) then
      raise exception 'a fixed-price counteroffer must differ and be flagged';
    end if;
  elsif job_row.pricing_method = 'range' then
    if new.kind = 'accept' then
      raise exception 'range jobs use offer or counter';
    end if;
    if new.driver_amount_cents between job_row.budget_min_cents and job_row.budget_max_cents then
      if new.outside_range or new.kind <> 'offer' then
        raise exception 'an in-range amount is an offer and is not flagged';
      end if;
    elsif not new.outside_range or new.kind <> 'counter' then
      raise exception 'an amount outside the range must be a flagged counteroffer';
    end if;
  end if;

  return new;
end;
$$;

create trigger job_offers_guard
  before insert or update on public.job_offers
  for each row execute function public.guard_job_offers();

create or replace function public.guard_blocks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_migration_session() or public.is_admin() then
    return new;
  end if;
  if auth.uid() is null or new.customer_id is distinct from auth.uid() then
    raise exception 'customers can only manage their own blocks';
  end if;
  return new;
end;
$$;

create trigger customer_driver_blocks_guard
  before insert on public.customer_driver_blocks
  for each row execute function public.guard_blocks();

create or replace function public.guard_invitations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
begin
  if not public.is_admin() and not public.is_migration_session() then
    raise exception 'only an admin can invite a driver';
  end if;

  select * into job_row from public.jobs where id = new.job_id;
  if not found then
    raise exception 'job not found';
  end if;
  if job_row.assigned_driver_id is not null then
    raise exception 'an invitation cannot be used after a driver is assigned';
  end if;
  return new;
end;
$$;

create trigger job_driver_invitations_guard
  before insert on public.job_driver_invitations
  for each row execute function public.guard_invitations();

-- ---------------------------------------------------------------------------
-- Privileges. RLS still applies. These grants stop anon from calling discovery.
-- ---------------------------------------------------------------------------

revoke all on function public.is_migration_session() from public;
revoke all on function public.can_set_quote_prices() from public;
revoke all on function public.private_miles_between(double precision, double precision, double precision, double precision) from public;
revoke all on function public.driver_is_eligible_for_job(uuid) from public;
revoke all on function public.driver_job_feed() from public;
revoke all on function public.accept_admin_quote(uuid) from public;
revoke all on function public.handle_new_user() from public;
revoke all on function public.guard_profile_role() from public;
revoke all on function public.guard_drivers() from public;
revoke all on function public.guard_vehicles() from public;
revoke all on function public.guard_jobs() from public;
revoke all on function public.log_job_status() from public;
revoke all on function public.guard_job_offers() from public;
revoke all on function public.guard_blocks() from public;
revoke all on function public.guard_invitations() from public;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_assigned_driver(uuid) to anon, authenticated;
grant execute on function public.driver_job_feed() to authenticated;
grant execute on function public.accept_admin_quote(uuid) to authenticated;

-- Supabase grants execute to anon and service_role by default. Take discovery back.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.driver_job_feed()',
    'public.driver_is_eligible_for_job(uuid)',
    'public.private_miles_between(double precision, double precision, double precision, double precision)',
    'public.is_migration_session()',
    'public.can_set_quote_prices()'
  ]
  loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('revoke all on function %s from service_role', fn);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.accept_admin_quote(uuid) from anon';
  end if;
  execute 'grant execute on function public.driver_job_feed() to authenticated';
end $$;

-- API roles can reach the tables. Row Level Security decides each row.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant usage on schema public to anon';
    execute 'grant select on public.zones to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant usage on schema public to authenticated';
    execute 'grant select, insert, update, delete on all tables in schema public to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema public to service_role';
    execute 'grant select, insert, update, delete on all tables in schema public to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.zones enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.jobs enable row level security;
alter table public.job_private enable row level security;
alter table public.job_photos enable row level security;
alter table public.customer_driver_blocks enable row level security;
alter table public.job_driver_invitations enable row level security;
alter table public.job_offers enable row level security;
alter table public.job_events enable row level security;
alter table public.audit_log enable row level security;

-- A person can read their own profile. An admin can read every profile.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- A person can edit their own name and contact fields. The role trigger blocks a role change.
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Zone names are public reference data. Writes stay with the migration and admins.
create policy zones_select_active on public.zones
  for select to anon, authenticated
  using (active or public.is_admin());

create policy zones_admin_write on public.zones
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Drivers read their own record. Admin reads all. Other people do not.
create policy drivers_select_own on public.drivers
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

create policy drivers_update_own on public.drivers
  for update to authenticated
  using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid() or public.is_admin());

create policy drivers_admin_insert on public.drivers
  for insert to authenticated
  with check (public.is_admin() or profile_id = auth.uid());

create policy vehicles_select_own on public.vehicles
  for select to authenticated
  using (driver_id = auth.uid() or public.is_admin());

create policy vehicles_write_own on public.vehicles
  for all to authenticated
  using (driver_id = auth.uid() or public.is_admin())
  with check (driver_id = auth.uid() or public.is_admin());

-- Customers read their jobs. The assigned driver reads that job. Browsing drivers use the feed, not this table.
create policy jobs_select_parties on public.jobs
  for select to authenticated
  using (
    customer_id = auth.uid()
    or public.is_admin()
    or public.is_assigned_driver(id)
  );

-- A customer can create their own requested job. The trigger rejects quote prices and assignment.
create policy jobs_insert_own on public.jobs
  for insert to authenticated
  with check (customer_id = auth.uid() or public.is_admin());

-- Only an admin can update a job directly. Customers publish quote jobs through accept_admin_quote.
create policy jobs_admin_update on public.jobs
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Private contact and addresses: customer, assigned driver, and admin. No browsing driver.
create policy job_private_select_parties on public.job_private
  for select to authenticated
  using (
    public.is_admin()
    or public.is_assigned_driver(job_id)
    or exists (
      select 1 from public.jobs
      where jobs.id = job_private.job_id
        and jobs.customer_id = auth.uid()
    )
  );

create policy job_private_insert_owner on public.job_private
  for insert to authenticated
  with check (
    public.is_admin()
    or exists (
      select 1 from public.jobs
      where jobs.id = job_private.job_id
        and jobs.customer_id = auth.uid()
    )
  );

create policy job_private_admin_update on public.job_private
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Photos follow the same parties. Browsing drivers are not included, because a photo can show an address.
create policy job_photos_select_parties on public.job_photos
  for select to authenticated
  using (
    public.is_admin()
    or public.is_assigned_driver(job_id)
    or exists (
      select 1 from public.jobs
      where jobs.id = job_photos.job_id
        and jobs.customer_id = auth.uid()
    )
  );

create policy job_photos_insert_parties on public.job_photos
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      exists (
        select 1 from public.jobs
        where jobs.id = job_photos.job_id
          and jobs.customer_id = auth.uid()
      )
      and stage in ('request', 'report')
    )
    or (
      public.is_assigned_driver(job_id)
      and stage in ('pickup', 'dropoff', 'dump_receipt')
    )
  );

-- A customer manages only their own blocks. Drivers cannot see or edit the list.
create policy blocks_customer_select on public.customer_driver_blocks
  for select to authenticated
  using (customer_id = auth.uid() or public.is_admin());

create policy blocks_customer_insert on public.customer_driver_blocks
  for insert to authenticated
  with check (customer_id = auth.uid() or public.is_admin());

create policy blocks_customer_delete on public.customer_driver_blocks
  for delete to authenticated
  using (customer_id = auth.uid() or public.is_admin());

-- Invitations are an admin tool. The invited driver can read their own rows.
create policy invitations_select on public.job_driver_invitations
  for select to authenticated
  using (driver_id = auth.uid() or public.is_admin());

create policy invitations_admin_write on public.job_driver_invitations
  for insert to authenticated
  with check (public.is_admin());

create policy invitations_admin_delete on public.job_driver_invitations
  for delete to authenticated
  using (public.is_admin());

-- A customer sees offers on their jobs. A driver sees only their own offers. Admin sees all.
create policy offers_select_parties on public.job_offers
  for select to authenticated
  using (
    driver_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.jobs
      where jobs.id = job_offers.job_id
        and jobs.customer_id = auth.uid()
    )
  );

create policy offers_driver_insert on public.job_offers
  for insert to authenticated
  with check (driver_id = auth.uid());

-- A driver may withdraw their own active offer. They cannot mark it chosen.
create policy offers_driver_update on public.job_offers
  for update to authenticated
  using (driver_id = auth.uid() or public.is_admin())
  with check (
    public.is_admin()
    or (driver_id = auth.uid() and status in ('active', 'withdrawn'))
  );

create policy events_select_parties on public.job_events
  for select to authenticated
  using (
    public.is_admin()
    or public.is_assigned_driver(job_id)
    or exists (
      select 1 from public.jobs
      where jobs.id = job_events.job_id
        and jobs.customer_id = auth.uid()
    )
  );

-- Audit rows are for admins. The application writes them later through an admin session.
create policy audit_admin_select on public.audit_log
  for select to authenticated
  using (public.is_admin());

create policy audit_admin_insert on public.audit_log
  for insert to authenticated
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Private photo bucket. Browsing drivers have no policy, so they cannot read objects.
-- Path shape: {job_id}/{stage}/{filename}
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do update set public = false;

-- The platform already enables row level security on storage.objects and
-- storage.buckets. The migration role does not own those tables, so
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY fails with "must be owner".
-- Those two statements were removed in a one-time edit after hosted 0001
-- had already been applied. Do not re-run this file on the hosted project.

-- Authenticated users can see that the private bucket exists. Object policies still hide the files.
create policy job_photos_bucket_read on storage.buckets
  for select to authenticated
  using (id = 'job-photos');

create or replace function public.storage_job_id(object_name text)
returns uuid
language sql
stable
as $$
  select case
    when split_part(object_name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    then split_part(object_name, '/', 1)::uuid
    else null
  end;
$$;

create or replace function public.storage_stage(object_name text)
returns text
language sql
stable
as $$
  select split_part(object_name, '/', 2);
$$;

grant execute on function public.storage_job_id(text) to authenticated;
grant execute on function public.storage_stage(text) to authenticated;

-- The customer can read every photo on their own job.
create policy job_photos_storage_customer_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-photos'
    and exists (
      select 1 from public.jobs
      where jobs.id = public.storage_job_id(name)
        and jobs.customer_id = auth.uid()
    )
  );

-- The customer uploads the request and later report photos.
create policy job_photos_storage_customer_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-photos'
    and public.storage_stage(name) in ('request', 'report')
    and exists (
      select 1 from public.jobs
      where jobs.id = public.storage_job_id(name)
        and jobs.customer_id = auth.uid()
    )
  );

-- The assigned driver reads photos and uploads pickup, drop-off, and dump photos.
create policy job_photos_storage_assigned_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-photos'
    and public.is_assigned_driver(public.storage_job_id(name))
  );

create policy job_photos_storage_assigned_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-photos'
    and public.storage_stage(name) in ('pickup', 'dropoff', 'dump_receipt')
    and public.is_assigned_driver(public.storage_job_id(name))
  );

-- Admin can read and write every object in the private bucket.
create policy job_photos_storage_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'job-photos' and public.is_admin())
  with check (bucket_id = 'job-photos' and public.is_admin());
