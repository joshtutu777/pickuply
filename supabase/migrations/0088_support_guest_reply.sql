-- A guest reply stays open until the app confirms the email was sent.
-- Signed-in customers still move to awaiting_customer because the reply is in the app.
-- Apply locally only until a hosted migration is approved.

create or replace function public.admin_support_message(ticket uuid, message text, note boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  person uuid := auth.uid();
  clean text := btrim(message);
  owner uuid;
  test_account boolean;
  sent timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if clean = '' or char_length(clean) > 4000 then
    raise exception 'Write a message under 4000 characters.';
  end if;
  select profile_id, is_test into owner, test_account from public.support_tickets where id = ticket;
  if not found then
    raise exception 'That request was not found.';
  end if;
  insert into public.support_ticket_messages (ticket_id, author_id, kind, body)
  values (ticket, person, case when note then 'internal' else 'admin' end, clean);
  if not note then
    update public.support_tickets
    set assigned_admin_id = coalesce(assigned_admin_id, person),
        status = case when owner is not null then 'awaiting_customer' else status end
    where id = ticket;
    if owner is not null then
      sent := case when test_account then now() else null end;
      insert into public.notifications (profile_id, kind, title, body, href, dedupe_key, push_sent_at, email_sent_at, sms_sent_at)
      values (
        owner, 'support', 'Support replied to your request.', 'Open your request to read the reply.',
        '/contact/tickets/' || ticket::text, 'support-customer-' || ticket::text || '-' || extract(epoch from now())::bigint,
        sent, sent, sent
      );
    end if;
  end if;
end;
$$;

revoke all on function public.admin_support_message(uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_support_message(uuid, text, boolean) to authenticated;
