-- Phone verification stays profiles.created_at.
-- Registration is complete only when both a first and last name are saved.
-- registration_completed_at is that moment. It stays null until then.
-- Existing profiles that already have both name parts get the timestamp of their
-- last profile update. That is the closest stored time. It is not a guessed name
-- typed earlier. Names are not changed here.
-- Request names are copied onto an empty profile inside create_customer_request,
-- in the same transaction as the request. A later reviewed script can fill older
-- empty profiles from a reliable request name. This file does not run that script.

alter table public.profiles
  add column if not exists registration_completed_at timestamptz;

comment on column public.profiles.registration_completed_at is
  'When both first and last name were first saved. Null means the phone is verified and registration is not finished. Distinct from created_at.';

create index if not exists profiles_customer_registration_idx
  on public.profiles (registration_completed_at desc nulls last, created_at desc)
  where role = 'customer' and deleted_at is null;

-- Keeps a completion time once both name parts exist.
-- A direct update cannot invent the time, clear it, or set it without both names.
create or replace function public.stamp_registration_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.name_part_ok(new.first_name) is not null and public.name_part_ok(new.last_name) is not null then
    if tg_op = 'INSERT' then
      new.registration_completed_at := coalesce(new.registration_completed_at, now());
    else
      new.registration_completed_at := coalesce(old.registration_completed_at, now());
    end if;
  elsif tg_op = 'UPDATE' then
    new.registration_completed_at := old.registration_completed_at;
  else
    new.registration_completed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_registration_completed() from public, anon, authenticated, service_role;

drop trigger if exists profiles_stamp_registration on public.profiles;
create trigger profiles_stamp_registration
  before insert or update on public.profiles
  for each row execute function public.stamp_registration_completed();

alter table public.profiles disable trigger profiles_guard_role;
alter table public.profiles disable trigger profiles_stamp_registration;

update public.profiles
set registration_completed_at = updated_at
where registration_completed_at is null
  and public.name_part_ok(first_name) is not null
  and public.name_part_ok(last_name) is not null;

alter table public.profiles enable trigger profiles_stamp_registration;
alter table public.profiles enable trigger profiles_guard_role;

-- Splits a request name the same way the app splits a stored name.
-- One word fills the first name. Two words fill both. Three or more do not invent a last name.
-- An unusable name returns no row.
create or replace function public.profile_name_from_text(raw text)
returns table (given text, family text, stored_full text, complete boolean)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  cleaned text := nullif(regexp_replace(btrim(coalesce(raw, '')), '[[:space:]]+', ' ', 'g'), '');
  tokens text[];
  first_part text;
  last_part text;
begin
  if cleaned is null or char_length(cleaned) > 80 or cleaned !~ '[[:alpha:]]'
    or cleaned ~ '[^[:alpha:][:space:].''’-]' then
    return;
  end if;
  tokens := regexp_split_to_array(cleaned, ' ');
  first_part := public.name_part_ok(tokens[1]);
  if first_part is null then
    return;
  end if;
  if cardinality(tokens) = 1 then
    given := first_part;
    family := null;
    stored_full := first_part;
    complete := false;
    return next;
    return;
  end if;
  if cardinality(tokens) = 2 then
    last_part := public.name_part_ok(tokens[2]);
    if last_part is null then
      return;
    end if;
    given := first_part;
    family := last_part;
    stored_full := first_part || ' ' || last_part;
    complete := true;
    return next;
    return;
  end if;
  given := first_part;
  family := null;
  stored_full := cleaned;
  complete := false;
  return next;
end;
$$;

revoke all on function public.profile_name_from_text(text) from public, anon, authenticated, service_role;

-- Fills an empty profile from the request name. A saved name is left as it is.
-- Raises when the profile has no name and the request name cannot be stored,
-- so the request transaction rolls back instead of saving a nameless account.
create or replace function public.apply_missing_profile_name(raw_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  profile public.profiles%rowtype;
  parsed record;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into profile from public.profiles where id = uid;
  if not found then
    raise exception 'profile not found';
  end if;
  if profile.registration_completed_at is not null
    or nullif(btrim(coalesce(profile.full_name, '')), '') is not null
    or profile.first_name is not null
    or profile.last_name is not null then
    return;
  end if;
  select * into parsed from public.profile_name_from_text(raw_name);
  if not found then
    raise exception 'enter your name using letters, spaces, apostrophes, periods, or hyphens';
  end if;
  update public.profiles
  set
    first_name = parsed.given,
    last_name = parsed.family,
    full_name = parsed.stored_full
  where id = uid
    and registration_completed_at is null
    and nullif(btrim(coalesce(full_name, '')), '') is null
    and first_name is null
    and last_name is null;
end;
$$;

revoke all on function public.apply_missing_profile_name(text) from public, anon, service_role;
grant execute on function public.apply_missing_profile_name(text) to authenticated;

-- Same transaction as the request. A name that cannot be stored aborts the request.
do $$
declare
  src text;
  next text;
  anchor constant text := E'raise exception ''customer name is required'';\n  end if;';
  hooked constant text := E'raise exception ''customer name is required'';\n  end if;\n  perform public.apply_missing_profile_name(customer_name_value);';
begin
  src := replace(pg_get_functiondef('public.create_customer_request(uuid, jsonb)'::regprocedure), chr(13), '');
  if position(hooked in src) > 0 then
    next := src;
  else
    next := replace(src, anchor, hooked);
  end if;
  if position(hooked in next) = 0 then
    raise exception 'create_customer_request name sync hook was not found';
  end if;
  if next is distinct from src then
    execute next;
  end if;
end $$;

-- Read-only counts for the reviewed name backfill. Does not change rows.
create or replace function public.unnamed_customer_report()
returns table (category text, customers bigint)
language sql
stable
security definer
set search_path = public
as $$
  with blank as (
    select id
    from public.profiles
    where role = 'customer'
      and deleted_at is null
      and registration_completed_at is null
      and first_name is null
      and last_name is null
      and nullif(btrim(coalesce(full_name, '')), '') is null
  ),
  request_names as (
    select
      blank.id,
      cleaned.cleaned,
      exists (select 1 from public.profile_name_from_text(cleaned.cleaned)) as storable
    from blank
    join public.jobs job on job.customer_id = blank.id
    join public.job_private private on private.job_id = job.id
    cross join lateral (
      select nullif(regexp_replace(btrim(coalesce(private.customer_name, '')), '[[:space:]]+', ' ', 'g'), '') as cleaned
    ) cleaned
  ),
  grouped as (
    select
      blank.id,
      count(request_names.id) as job_rows,
      count(distinct request_names.cleaned) filter (where request_names.cleaned is not null) as distinct_names,
      count(distinct request_names.cleaned) filter (
        where request_names.storable
      ) as storable_names
    from blank
    left join request_names on request_names.id = blank.id
    group by blank.id
  )
  select 'no_name_no_jobs', count(*)
  from grouped
  where job_rows = 0
  union all
  select 'request_name_reliable', count(*)
  from grouped
  where job_rows > 0 and distinct_names = 1 and storable_names = 1
  union all
  select 'request_name_conflict', count(*)
  from grouped
  where distinct_names > 1
  union all
  select 'request_name_unusable', count(*)
  from grouped
  where job_rows > 0 and distinct_names <= 1 and storable_names = 0
  union all
  select 'partial_name', count(*)
  from public.profiles
  where role = 'customer'
    and deleted_at is null
    and registration_completed_at is null
    and (
      first_name is not null
      or last_name is not null
      or nullif(btrim(coalesce(full_name, '')), '') is not null
    )
  union all
  select 'registered', count(*)
  from public.profiles
  where role = 'customer'
    and deleted_at is null
    and registration_completed_at is not null;
$$;

revoke all on function public.unnamed_customer_report() from public, anon, authenticated, service_role;

-- Fills only an empty customer profile when every request uses the same storable name.
-- Does not change a profile that already has a name. Does not invent a last name.
-- Not called by this migration. scripts/sql/backfill-unnamed-customers-from-requests.sql
-- previews the counts and rolls the update back until that rollback is changed.
create or replace function public.backfill_missing_profile_names_from_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer := 0;
  person record;
  name_count integer;
  agreed text;
  parsed record;
begin
  for person in
    select id
    from public.profiles
    where role = 'customer'
      and deleted_at is null
      and registration_completed_at is null
      and first_name is null
      and last_name is null
      and nullif(btrim(coalesce(full_name, '')), '') is null
  loop
    select count(distinct cleaned)::integer, min(cleaned)
    into name_count, agreed
    from (
      select nullif(regexp_replace(btrim(coalesce(private.customer_name, '')), '[[:space:]]+', ' ', 'g'), '') as cleaned
      from public.jobs job
      join public.job_private private on private.job_id = job.id
      where job.customer_id = person.id
    ) names
    where cleaned is not null;

    if name_count is distinct from 1 or agreed is null then
      continue;
    end if;
    select * into parsed from public.profile_name_from_text(agreed);
    if not found then
      continue;
    end if;
    update public.profiles
    set
      first_name = parsed.given,
      last_name = parsed.family,
      full_name = parsed.stored_full
    where id = person.id
      and registration_completed_at is null
      and first_name is null
      and last_name is null
      and nullif(btrim(coalesce(full_name, '')), '') is null;
    if found then
      updated_count := updated_count + 1;
    end if;
  end loop;
  return updated_count;
end;
$$;

revoke all on function public.backfill_missing_profile_names_from_requests() from public, anon, authenticated, service_role;
