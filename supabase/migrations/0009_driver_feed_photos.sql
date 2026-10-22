-- Eligible drivers can read request-stage photos. Other stages stay private.
-- Do not apply this file to the hosted project until the owner approves.

create policy job_photos_select_request_eligible on public.job_photos
  for select to authenticated
  using (
    stage = 'request'
    and public.driver_is_eligible_for_job(job_id)
  );

create policy job_photos_storage_request_eligible on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-photos'
    and public.storage_stage(name) = 'request'
    and public.driver_is_eligible_for_job(public.storage_job_id(name))
  );

create or replace function public.invite_driver(target_job uuid, target_driver uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  driver_row public.drivers%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can invite a driver';
  end if;
  select * into job_row from public.jobs where id = target_job;
  if not found or job_row.status <> 'open' then
    raise exception 'only an open job can be invited';
  end if;
  select * into driver_row from public.drivers where profile_id = target_driver;
  if not found or driver_row.status not in ('active', 'approved_new') then
    raise exception 'that driver is not approved';
  end if;
  insert into public.job_driver_invitations (job_id, driver_id, invited_by)
  values (target_job, target_driver, auth.uid())
  on conflict (job_id, driver_id) do nothing;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'invite_driver',
    'job',
    target_job,
    jsonb_build_object('driver_id', target_driver)
  );
end;
$function$;

revoke all on function public.invite_driver(uuid, uuid) from public;
revoke all on function public.invite_driver(uuid, uuid) from anon;
revoke all on function public.invite_driver(uuid, uuid) from service_role;
grant execute on function public.invite_driver(uuid, uuid) to authenticated;
