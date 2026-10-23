-- Customers ask for help here instead of starting a chat with admin.
-- A person sees their own requests. An admin sees every request.
-- Local only until the owner applies it to the hosted database.

create sequence public.help_case_seq start with 1042;

create table public.help_requests (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique,
  profile_id uuid not null references public.profiles (id),
  topic text not null,
  job_id uuid references public.jobs (id),
  body text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint help_requests_status check (status in ('open', 'waiting', 'resolved')),
  constraint help_requests_topic check (char_length(btrim(topic)) between 2 and 80),
  constraint help_requests_body check (char_length(btrim(body)) between 3 and 2000)
);

create table public.help_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.help_requests (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text not null,
  created_at timestamptz not null default now(),
  constraint help_messages_body check (char_length(btrim(body)) between 1 and 2000)
);

create index help_messages_request_idx on public.help_messages (request_id, created_at);

create table public.help_photos (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.help_requests (id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);

alter table public.help_requests enable row level security;
alter table public.help_messages enable row level security;
alter table public.help_photos enable row level security;

-- The requester reads their case. An admin reads every case.
create policy help_requests_select on public.help_requests
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

create policy help_messages_select on public.help_messages
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.help_requests
      where help_requests.id = request_id and help_requests.profile_id = auth.uid()
    )
  );

create policy help_photos_select on public.help_photos
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.help_requests
      where help_requests.id = request_id and help_requests.profile_id = auth.uid()
    )
  );

revoke all on table public.help_requests from public, anon, service_role;
revoke all on table public.help_messages from public, anon, service_role;
revoke all on table public.help_photos from public, anon, service_role;
grant select on table public.help_requests to authenticated;
grant select on table public.help_messages to authenticated;
grant select on table public.help_photos to authenticated;

insert into storage.buckets (id, name, public)
values ('help-photos', 'help-photos', false)
on conflict (id) do update set public = false;

do $policy$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'help_photos_read') then
    create policy help_photos_read on storage.objects
      for select to authenticated
      using (
        bucket_id = 'help-photos'
        and (
          public.is_admin()
          or split_part(name, '/', 1) = auth.uid()::text
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'help_photos_insert') then
    create policy help_photos_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'help-photos'
        and split_part(name, '/', 1) = auth.uid()::text
      );
  end if;
end;
$policy$;

create or replace function public.create_help_request(
  topic text,
  message_body text,
  related_job uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  request_id uuid;
  case_label text;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if related_job is not null and not exists (
    select 1 from public.jobs
    where id = related_job and (customer_id = uid or assigned_driver_id = uid or public.is_admin())
  ) then
    raise exception 'choose one of your jobs';
  end if;
  case_label := 'HR-' || nextval('public.help_case_seq')::text;
  insert into public.help_requests (case_number, profile_id, topic, job_id, body)
  values (case_label, uid, btrim(topic), related_job, btrim(message_body))
  returning id into request_id;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (uid, 'create_help_request', 'help_request', request_id, jsonb_build_object('case_number', case_label));
  return request_id;
end;
$$;

revoke all on function public.create_help_request(text, text, uuid) from public, anon, service_role;
grant execute on function public.create_help_request(text, text, uuid) to authenticated;

create or replace function public.reply_help_request(target_request uuid, message_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  owner uuid;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select profile_id into owner from public.help_requests where id = target_request;
  if owner is null then
    raise exception 'request not found';
  end if;
  if owner is distinct from uid and not public.is_admin() then
    raise exception 'you cannot reply to this request';
  end if;
  if (select status from public.help_requests where id = target_request) = 'resolved' then
    raise exception 'this request is resolved';
  end if;
  insert into public.help_messages (request_id, sender_id, body)
  values (target_request, uid, btrim(message_body));
  if public.is_admin() then
    update public.help_requests set status = 'waiting', updated_at = now() where id = target_request;
    perform public.enqueue_notification(
      owner, null, 'help_reply', 'Pickuply replied',
      'Pickuply replied to your help request.',
      '/help/requests/' || target_request::text,
      'help:' || target_request::text || ':' || extract(epoch from clock_timestamp())::bigint::text
    );
  else
    update public.help_requests set status = 'open', updated_at = now() where id = target_request;
  end if;
end;
$$;

revoke all on function public.reply_help_request(uuid, text) from public, anon, service_role;
grant execute on function public.reply_help_request(uuid, text) to authenticated;

create or replace function public.set_help_status(target_request uuid, next_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can change help status';
  end if;
  if next_status not in ('open', 'waiting', 'resolved') then
    raise exception 'choose a status';
  end if;
  update public.help_requests
  set status = next_status, updated_at = now()
  where id = target_request;
  if not found then
    raise exception 'request not found';
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (auth.uid(), 'set_help_status', 'help_request', target_request, jsonb_build_object('status', next_status));
end;
$$;

revoke all on function public.set_help_status(uuid, text) from public, anon, service_role;
grant execute on function public.set_help_status(uuid, text) to authenticated;

create or replace function public.attach_help_photo(target_request uuid, photo_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if photo_path !~ ('^' || uid::text || '/' || target_request::text || '/[A-Za-z0-9._-]+$') then
    raise exception 'that photo could not be saved';
  end if;
  if not exists (
    select 1 from public.help_requests
    where id = target_request and profile_id = uid
  ) then
    raise exception 'request not found';
  end if;
  insert into public.help_photos (request_id, storage_path) values (target_request, photo_path);
end;
$$;

revoke all on function public.attach_help_photo(uuid, text) from public, anon, service_role;
grant execute on function public.attach_help_photo(uuid, text) to authenticated;

create view public.help_request_list
with (security_invoker = true) as
select
  id,
  case_number,
  topic,
  status,
  created_at,
  profile_id,
  job_id,
  body,
  greatest(0, floor(extract(epoch from (now() - created_at)) / 60))::int as waited_minutes
from public.help_requests;

revoke all on public.help_request_list from public, anon, service_role;
grant select on public.help_request_list to authenticated;
