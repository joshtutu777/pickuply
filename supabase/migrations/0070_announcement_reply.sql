-- Reply on an announcement opens that person's private Pickuply Support conversation.
-- Customers still cannot start support from the Support page until a thread exists.

create or replace function public.open_announcement_reply()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  thread_id uuid;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if not exists (
    select 1 from public.notifications
    where profile_id = uid and kind = 'admin_announcement'
  ) then
    raise exception 'there is no announcement to reply to';
  end if;
  select id into thread_id
  from public.message_threads
  where requester_id = uid and kind = 'support';
  if thread_id is null then
    insert into public.message_threads (requester_id, kind)
    values (uid, 'support')
    returning id into thread_id;
  end if;
  return thread_id;
end;
$$;

revoke all on function public.open_announcement_reply() from public, anon, service_role;
grant execute on function public.open_announcement_reply() to authenticated;
