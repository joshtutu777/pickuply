-- The notification helper's argument name matched a column, so a new job
-- could not be saved.
-- Do not apply this file to the hosted project until the owner approves it.

create or replace function public.enqueue_notification(
  recipient uuid,
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
begin
  if recipient is null or coalesce(enqueue_notification.dedupe_key, '') = '' then
    return;
  end if;
  insert into public.notifications (profile_id, job_id, kind, title, body, href, dedupe_key)
  values (
    recipient,
    target_job,
    left(enqueue_notification.kind, 80),
    left(enqueue_notification.title, 120),
    left(enqueue_notification.body, 400),
    enqueue_notification.href,
    enqueue_notification.dedupe_key
  )
  on conflict on constraint notifications_dedupe do nothing;
end;
$$;

revoke all on function public.enqueue_notification(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;
