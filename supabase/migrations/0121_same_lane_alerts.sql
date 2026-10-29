-- Same-lane alerts. A test request does not notify a real driver or a real admin.
-- Existing rows stay in place. Nothing is deleted or rewritten.

do $lane$
declare
  src text;
  next text;
begin
  src := replace(pg_get_functiondef('public.notify_on_job()'::regprocedure), chr(13), '');
  next := replace(
    src,
    'and not profiles.blocked',
    E'and not profiles.blocked\n          and profiles.is_test = new.is_test\n          and profiles.test_retired_at is null'
  );
  if next = src then
    raise exception 'open job driver loop was not found';
  end if;
  execute next;
end
$lane$;

create or replace function public.notify_admins(
  target_job uuid,
  kind text,
  title text,
  body text,
  href text,
  dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid;
  job_test boolean := false;
begin
  if target_job is not null then
    select jobs.is_test into job_test from public.jobs where jobs.id = target_job;
    job_test := coalesce(job_test, false);
  end if;
  for admin_id in
    select profiles.id
    from public.profiles
    where profiles.role = 'admin'
      and profiles.is_test = job_test
      and profiles.test_retired_at is null
  loop
    perform public.enqueue_notification(admin_id, target_job, kind, title, body, href, dedupe_key);
  end loop;
end;
$$;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (
    profile_id = auth.uid()
    and (
      job_id is null
      or public.job_is_test(job_id) = public.actor_is_test()
    )
  );
