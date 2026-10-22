-- The photo policy must call a function the signed-in role can execute.
-- driver_is_eligible_for_job stays callable only by the owner. This wrapper
-- returns a boolean and does not expose private job fields.

create or replace function public.request_photo_visible(target_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.driver_is_eligible_for_job(target_job);
$$;

revoke all on function public.request_photo_visible(uuid) from public;
revoke all on function public.request_photo_visible(uuid) from anon;
revoke all on function public.request_photo_visible(uuid) from service_role;
grant execute on function public.request_photo_visible(uuid) to authenticated;

drop policy if exists job_photos_select_request_eligible on public.job_photos;
create policy job_photos_select_request_eligible on public.job_photos
  for select to authenticated
  using (
    stage = 'request'
    and public.request_photo_visible(job_id)
  );

drop policy if exists job_photos_storage_request_eligible on storage.objects;
create policy job_photos_storage_request_eligible on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-photos'
    and public.storage_stage(name) = 'request'
    and public.request_photo_visible(public.storage_job_id(name))
  );
