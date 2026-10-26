-- Public support tickets. Apply locally only until a hosted migration is approved.
-- Logged-out visitors cannot read tickets. Customers see only their own.

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  first_name text not null,
  last_name text not null default '',
  email text not null,
  topic text not null,
  body text not null,
  job_reference text not null default '',
  job_id uuid references public.jobs (id),
  profile_id uuid references public.profiles (id),
  status text not null default 'open',
  assigned_admin_id uuid references public.profiles (id),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_tickets_name check (char_length(btrim(first_name)) between 1 and 80 and char_length(last_name) <= 80),
  constraint support_tickets_email check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 160),
  constraint support_tickets_topic check (topic in ('pickup-delivery', 'driver-account', 'payments', 'booking', 'technical', 'other')),
  constraint support_tickets_body check (char_length(btrim(body)) between 1 and 4000),
  constraint support_tickets_job_reference check (char_length(job_reference) <= 80),
  constraint support_tickets_status check (status in ('open', 'awaiting_customer', 'resolved', 'closed')),
  constraint support_tickets_reference check (reference ~ '^PLY-[A-Z0-9]{8}$')
);

create table public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  author_id uuid references public.profiles (id),
  kind text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint support_ticket_messages_kind check (kind in ('customer', 'admin', 'internal')),
  constraint support_ticket_messages_body check (char_length(btrim(body)) between 1 and 4000)
);

create index support_tickets_status_idx on public.support_tickets (status, created_at desc);
create index support_ticket_messages_ticket_idx on public.support_ticket_messages (ticket_id, created_at);

create or replace function public.touch_support_ticket()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger support_tickets_touch
  before update on public.support_tickets
  for each row execute function public.touch_support_ticket();

create or replace function public.support_reference()
returns text
language sql
volatile
as $$
  select 'PLY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
$$;

drop function if exists public.create_support_ticket(text, text, text, text, text, text, uuid);

create or replace function public.create_support_ticket(
  first_name text,
  last_name text,
  email text,
  topic text,
  message text,
  job_reference text,
  requested_job uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_email text := lower(btrim(email));
  clean_message text := btrim(message);
  ticket_id uuid;
  ticket_reference text;
  person uuid := auth.uid();
  linked_job uuid;
  test_account boolean := false;
  sent timestamptz;
begin
  if btrim(first_name) = '' or clean_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or clean_message = '' then
    raise exception 'Check the name, email, and message.';
  end if;
  if topic not in ('pickup-delivery', 'driver-account', 'payments', 'booking', 'technical', 'other') then
    raise exception 'Choose a topic.';
  end if;
  perform public.consume_rate_limit('support-ticket', coalesce(person::text, clean_email), 5, 3600, 'Too many messages. Try again later.');
  if exists (
    select 1 from public.support_tickets
    where support_tickets.email = clean_email
      and support_tickets.topic = create_support_ticket.topic
      and support_tickets.body = clean_message
      and created_at > now() - interval '15 minutes'
  ) then
    raise exception 'This message was already sent.';
  end if;
  if person is not null then
    select profiles.is_test into test_account from public.profiles where id = person;
    if requested_job is not null then
      select jobs.id into linked_job
      from public.jobs
      where jobs.id = requested_job
        and (jobs.customer_id = person or jobs.assigned_driver_id = person);
    end if;
  end if;
  insert into public.support_tickets (
    reference, first_name, last_name, email, topic, body, job_reference, job_id, profile_id, is_test
  ) values (
    public.support_reference(),
    btrim(first_name),
    btrim(coalesce(last_name, '')),
    clean_email,
    topic,
    clean_message,
    left(btrim(coalesce(job_reference, '')), 80),
    linked_job,
    person,
    coalesce(test_account, false)
  ) returning id, reference into ticket_id, ticket_reference;
  insert into public.support_ticket_messages (ticket_id, author_id, kind, body)
  values (ticket_id, person, 'customer', clean_message);
  sent := case when coalesce(test_account, false) then now() else null end;
  insert into public.notifications (profile_id, kind, title, body, href, dedupe_key, push_sent_at, email_sent_at, sms_sent_at)
  select profiles.id, 'support', 'New support request received.', 'A new request is in the support inbox.',
    '/admin/support/' || ticket_id::text, 'support-new-' || ticket_id::text, sent, sent, sent
  from public.profiles
  where profiles.role = 'admin' and not profiles.blocked;
  return ticket_reference;
end;
$$;

create or replace function public.customer_support_reply(ticket uuid, message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  person uuid := auth.uid();
  clean text := btrim(message);
begin
  if person is null or clean = '' or char_length(clean) > 4000 then
    raise exception 'Write a reply under 4000 characters.';
  end if;
  if not exists (select 1 from public.support_tickets where id = ticket and profile_id = person) then
    raise exception 'That request was not found.';
  end if;
  insert into public.support_ticket_messages (ticket_id, author_id, kind, body)
  values (ticket, person, 'customer', clean);
  update public.support_tickets set status = 'open' where id = ticket and status <> 'closed';
  insert into public.notifications (profile_id, kind, title, body, href, dedupe_key)
  select profiles.id, 'support', 'New support request received.', 'A customer replied in the support inbox.',
    '/admin/support/' || ticket::text, 'support-reply-' || ticket::text || '-' || extract(epoch from now())::bigint
  from public.profiles
  where profiles.role = 'admin' and not profiles.blocked;
end;
$$;

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
    set status = 'awaiting_customer', assigned_admin_id = coalesce(assigned_admin_id, person)
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

revoke all on function public.touch_support_ticket() from public, anon, authenticated, service_role;
revoke all on function public.support_reference() from public, anon, authenticated, service_role;
revoke all on function public.create_support_ticket(text, text, text, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.customer_support_reply(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_support_message(uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.create_support_ticket(text, text, text, text, text, text, uuid) to anon, authenticated;
grant execute on function public.customer_support_reply(uuid, text) to authenticated;
grant execute on function public.admin_support_message(uuid, text, boolean) to authenticated;

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

create policy support_tickets_admin_all on public.support_tickets
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy support_tickets_owner_read on public.support_tickets
  for select to authenticated
  using (profile_id = auth.uid());

create policy support_messages_admin_all on public.support_ticket_messages
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy support_messages_owner_read on public.support_ticket_messages
  for select to authenticated
  using (
    kind <> 'internal'
    and exists (
      select 1 from public.support_tickets
      where support_tickets.id = ticket_id
        and support_tickets.profile_id = auth.uid()
    )
  );

grant select on public.support_tickets to authenticated;
grant select on public.support_ticket_messages to authenticated;
grant update on public.support_tickets to authenticated;
