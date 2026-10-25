-- Assigned-driver card and the driver's next job step.
-- Customers cannot read another person's profile. This returns only a first
-- name, profile photo path, and vehicle label for a job they are part of.
-- Do not apply this file to the hosted project until the owner approves it.

create or replace function public.assigned_driver_card(target_job uuid)
returns table (
  first_name text,
  photo_path text,
  vehicle_label text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  driver uuid;
begin
  if uid is null then
    return;
  end if;

  select jobs.assigned_driver_id
  into driver
  from public.jobs
  where jobs.id = target_job;

  if driver is null then
    return;
  end if;

  if uid is distinct from driver
    and not public.is_admin()
    and not exists (
      select 1
      from public.jobs
      where jobs.id = target_job
        and jobs.customer_id = uid
    ) then
    return;
  end if;

  return query
  select
    split_part(coalesce(profiles.full_name, 'Driver'), ' ', 1),
    profiles.photo_url,
    trim(both ' ' from coalesce(vehicles.type::text, '') || ' ' || coalesce(vehicles.make, ''))
  from public.profiles
  left join lateral (
    select type, make
    from public.vehicles
    where driver_id = driver
    order by approved desc, created_at desc
    limit 1
  ) vehicles on true
  where profiles.id = driver;
end;
$$;

revoke all on function public.assigned_driver_card(uuid) from public, anon, service_role;
grant execute on function public.assigned_driver_card(uuid) to authenticated;

-- A customer may see the assigned driver's profile photo and nothing else
-- in the private driver-docs bucket.
create policy driver_docs_customer_profile_read on storage.objects
for select to authenticated
using (
  bucket_id = 'driver-docs'
  and name ~ '/profile\.(jpg|jpeg|png|webp)$'
  and exists (
    select 1
    from public.jobs
    where jobs.customer_id = auth.uid()
      and jobs.assigned_driver_id::text = split_part(storage.objects.name, '/', 1)
  )
);

create or replace function public.advance_job(target_job uuid, next_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current_status public.job_status;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;

  select status
  into current_status
  from public.jobs
  where id = target_job
    and assigned_driver_id = uid
  for update;

  if current_status is null then
    raise exception 'only the assigned driver can update this job';
  end if;

  if not (
    (current_status = 'assigned' and next_status = 'en_route')
    or (current_status = 'en_route' and next_status = 'arrived')
    or (current_status = 'arrived' and next_status = 'item_check')
    or (current_status = 'in_transit' and next_status = 'delivered')
  ) then
    raise exception 'that step is not available';
  end if;

  update public.jobs
  set status = next_status::public.job_status,
      updated_at = now()
  where id = target_job;
end;
$$;

revoke all on function public.advance_job(uuid, text) from public, anon, service_role;
grant execute on function public.advance_job(uuid, text) to authenticated;
