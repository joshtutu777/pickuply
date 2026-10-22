-- Storage only. Do not run 0001_core.sql again.
-- The hosted project already has the public schema from 0001.
-- This file does not alter, drop, or rewrite any public table.
-- It also does not change ownership of storage.objects or storage.buckets.
--
-- Hosted Supabase already enables row level security on those tables.
-- ALTER TABLE storage.objects / storage.buckets is rejected with
-- "must be owner of table objects". Those statements are intentionally absent.
--
-- Apply this from the Supabase SQL editor after you approve it.
-- If CREATE POLICY is rejected, create the same policies in
-- Storage → Policies instead of changing table ownership.

-- Path helpers used by the policies. They parse a name only.
-- They do not read private job data.
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

-- Private bucket. Re-running this keeps the bucket private.
insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do update set public = false;

-- Authenticated users can see that the bucket exists. Object policies hide the files.
-- CREATE POLICY has no IF NOT EXISTS on this Postgres version, so each policy is created only when missing.
do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'job_photos_bucket_read'
  ) then
    create policy job_photos_bucket_read
      on storage.buckets
      for select
      to authenticated
      using (id = 'job-photos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'job_photos_storage_customer_read'
  ) then
    create policy job_photos_storage_customer_read
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'job-photos'
        and exists (
          select 1 from public.jobs
          where jobs.id = public.storage_job_id(name)
            and jobs.customer_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'job_photos_storage_customer_insert'
  ) then
    create policy job_photos_storage_customer_insert
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'job-photos'
        and public.storage_stage(name) in ('request', 'report')
        and exists (
          select 1 from public.jobs
          where jobs.id = public.storage_job_id(name)
            and jobs.customer_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'job_photos_storage_assigned_read'
  ) then
    create policy job_photos_storage_assigned_read
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'job-photos'
        and public.is_assigned_driver(public.storage_job_id(name))
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'job_photos_storage_assigned_insert'
  ) then
    create policy job_photos_storage_assigned_insert
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'job-photos'
        and public.storage_stage(name) in ('pickup', 'dropoff', 'dump_receipt')
        and public.is_assigned_driver(public.storage_job_id(name))
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'job_photos_storage_admin_all'
  ) then
    create policy job_photos_storage_admin_all
      on storage.objects
      for all
      to authenticated
      using (bucket_id = 'job-photos' and public.is_admin())
      with check (bucket_id = 'job-photos' and public.is_admin());
  end if;
end
$policy$;
