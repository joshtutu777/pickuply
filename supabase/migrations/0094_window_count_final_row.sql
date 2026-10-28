-- A new request inserts the job before its pickup windows exist.
-- The deferred count check was reading that first row and rejecting a valid windows request.

create or replace function public.guard_window_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  saved integer;
  availability text;
begin
  if public.is_migration_session() then
    return new;
  end if;
  select pickup_availability into availability
  from public.jobs
  where id = new.id;
  select count(*)::integer into saved
  from public.job_pickup_windows
  where job_id = new.id;
  if availability = 'windows' and saved not between 1 and 3 then
    raise exception 'Add between 1 and 3 pickup windows.';
  end if;
  if availability is distinct from 'windows' and saved > 0 then
    raise exception 'This choice does not use pickup windows.';
  end if;
  return new;
end;
$$;
