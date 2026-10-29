-- Block chat messages that try to move payment off Pickuply.
-- A support admin can still name those services in a support thread.
-- Repeat attempts are recorded by the message route, which writes an in-app admin alert.

create or replace function public.contains_off_platform_payment(value text)
returns boolean
language sql
immutable
as $$
  select coalesce(value, '') ~* (
    '(^|[^[:alnum:]])(venmo|cash[[:space:]]*app|cashapp|zelle|paypal)([^[:alnum:]]|$)'
    || '|(^|[^[:alnum:]])pay[[:space:]]+cash([^[:alnum:]]|$)'
    || '|(^|[^[:alnum:]])pay[[:space:]]+me[[:space:]]+directly([^[:alnum:]]|$)'
  );
$$;

create or replace function public.reject_off_platform_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  support_admin boolean;
begin
  if not public.contains_off_platform_payment(new.body) then
    return new;
  end if;
  select threads.kind = 'support' and public.is_admin()
    into support_admin
  from public.message_threads threads
  where threads.id = new.thread_id;
  if coalesce(support_admin, false) then
    return new;
  end if;
  raise exception 'Payments must go through Pickuply so you''re protected.';
end;
$$;

drop trigger if exists messages_reject_off_platform on public.messages;
create trigger messages_reject_off_platform
  before insert on public.messages
  for each row
  execute function public.reject_off_platform_payment();
