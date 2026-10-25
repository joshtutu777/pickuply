-- Request photos are attached after the request is saved. Saving now
-- publishes the request, so the customer can still add those photos while
-- it is open and unassigned.

create or replace function public.attach_request_photo(
  target_job_id uuid,
  target_path text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  existing_id uuid;
  existing_job uuid;
  existing_stage public.photo_stage;
  existing_uploader uuid;
  inserted_id uuid;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if target_job_id is null or target_path is null then
    raise exception 'photo path is required';
  end if;
  if target_path !~ (
    '^' || target_job_id::text || '/request/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.jpg$'
  ) then
    raise exception 'invalid photo path';
  end if;
  if not exists (
    select 1
    from public.jobs
    where id = target_job_id
      and customer_id = uid
      and (
        status in ('requested', 'open')
        or (
          status = 'in_review'
          and detail_request is not null
          and detail_request->>'answered_at' is null
          and detail_request->'items' ? 'photos'
        )
      )
  ) then
    raise exception 'request not found';
  end if;

  select id, job_id, stage, uploaded_by
  into existing_id, existing_job, existing_stage, existing_uploader
  from public.job_photos
  where storage_path = target_path;

  if existing_id is not null then
    if existing_job = target_job_id
      and existing_stage = 'request'
      and existing_uploader = uid then
      return existing_id;
    end if;
    raise exception 'photo path is already used';
  end if;

  begin
    insert into public.job_photos (job_id, stage, storage_path, uploaded_by)
    values (target_job_id, 'request', target_path, uid)
    returning id into inserted_id;
  exception
    when unique_violation then
      select id into inserted_id
      from public.job_photos
      where storage_path = target_path
        and job_id = target_job_id
        and stage = 'request'
        and uploaded_by = uid;
      if inserted_id is null then
        raise exception 'photo path is already used';
      end if;
  end;

  return inserted_id;
end;
$function$;
