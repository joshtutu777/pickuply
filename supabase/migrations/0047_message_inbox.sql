-- Support messages belong in the inbox, and alerts open that conversation.
-- A missing document request also links to the upload field.
-- Attachments stay in a private bucket.

create or replace function public.message_href(target_thread uuid, recipient uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when threads.kind = 'job' and threads.driver_id = recipient then '/driver/jobs/' || threads.job_id::text
    when threads.kind = 'job' then '/jobs/' || threads.job_id::text
    when exists (select 1 from public.profiles where id = recipient and role = 'admin') then '/admin/messages/' || threads.id::text
    when exists (select 1 from public.drivers where profile_id = recipient) then '/driver/messages?thread=' || threads.id::text
    else '/account/messages?thread=' || threads.id::text
  end
  from public.message_threads threads
  where threads.id = target_thread;
$$;

revoke all on function public.message_href(uuid, uuid) from public, anon, service_role;
grant execute on function public.message_href(uuid, uuid) to authenticated;

create or replace function public.post_message(target_thread uuid, message_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  thread public.message_threads%rowtype;
  clean text := btrim(coalesce(message_body, ''));
  shown text;
  message_id uuid;
  area text;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if not public.message_participant(target_thread) then
    raise exception 'you cannot post in this thread';
  end if;
  if char_length(clean) < 1 or char_length(clean) > 1000 then
    raise exception 'enter a message';
  end if;

  select * into thread from public.message_threads where id = target_thread;
  if thread.resolved_at is not null or (thread.closes_at is not null and thread.closes_at <= now()) then
    raise exception 'this conversation is closed';
  end if;

  shown := public.redact_contact(clean);
  insert into public.messages (thread_id, sender_id, body, body_original)
  values (target_thread, uid, shown, clean)
  returning id into message_id;

  perform public.mark_thread_read(target_thread);

  if thread.job_id is not null then
    select left(pickup_area, 80) into area from public.jobs where id = thread.job_id;
  end if;

  if thread.requester_id is distinct from uid then
    perform public.enqueue_notification(
      thread.requester_id, thread.job_id, 'new_message', 'New message',
      'You have a new message.',
      public.message_href(target_thread, thread.requester_id),
      'message:' || message_id
    );
  end if;

  if thread.driver_id is not null and thread.driver_id is distinct from uid then
    perform public.enqueue_notification(
      thread.driver_id, thread.job_id, 'new_message', 'New message',
      'You have a new message.',
      public.message_href(target_thread, thread.driver_id),
      'message:' || message_id
    );
  end if;

  if not public.is_admin() then
    perform public.enqueue_notification(
      admin_row.id, thread.job_id, 'new_message', 'New message',
      case
        when thread.kind = 'support' then 'New support message.'
        else 'New message on a job in ' || coalesce(area, 'the service area') || '.'
      end,
      public.message_href(target_thread, admin_row.id),
      'message:' || message_id || ':' || admin_row.id
    )
    from public.profiles admin_row
    where admin_row.role = 'admin' and admin_row.id is distinct from uid;
  end if;
end;
$$;

drop function if exists public.thread_messages(uuid);

create function public.thread_messages(target_thread uuid)
returns table (
  id uuid,
  body text,
  created_at timestamptz,
  mine boolean,
  sender_name text,
  seen boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.message_participant(target_thread) then
    return;
  end if;

  return query
  select
    messages.id,
    case
      when public.is_admin() then coalesce(messages.body_original, messages.body)
      else messages.body
    end,
    messages.created_at,
    messages.sender_id = auth.uid(),
    case
      when messages.sender_id = auth.uid() then 'You'
      when profiles.role = 'admin' then 'Pickuply'
      else split_part(coalesce(profiles.full_name, 'Pickuply'), ' ', 1)
    end,
    messages.sender_id = auth.uid()
      and exists (
        select 1
        from public.message_reads
        where message_reads.thread_id = target_thread
          and message_reads.profile_id is distinct from auth.uid()
          and message_reads.last_read_at >= messages.created_at
      )
  from public.messages
  join public.profiles on profiles.id = messages.sender_id
  where messages.thread_id = target_thread
  order by messages.created_at;
end;
$$;

revoke all on function public.thread_messages(uuid) from public, anon, service_role;
grant execute on function public.thread_messages(uuid) to authenticated;

create or replace function public.my_inbox()
returns table (
  thread_id uuid,
  kind text,
  title text,
  unread integer,
  last_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return;
  end if;

  return query
  select
    threads.id,
    threads.kind,
    case
      when threads.kind = 'support' then 'Pickuply Support'
      else 'Job in ' || left(coalesce(jobs.pickup_area, 'your area'), 80)
    end,
    (
      select count(*)::integer
      from public.messages
      where messages.thread_id = threads.id
        and messages.sender_id is distinct from uid
        and messages.created_at > coalesce(
          (
            select message_reads.last_read_at
            from public.message_reads
            where message_reads.thread_id = threads.id
              and message_reads.profile_id = uid
          ),
          '-infinity'::timestamptz
        )
    ),
    (
      select max(messages.created_at)
      from public.messages
      where messages.thread_id = threads.id
    )
  from public.message_threads threads
  left join public.jobs on jobs.id = threads.job_id
  where public.message_participant(threads.id)
    and (threads.requester_id = uid or threads.driver_id = uid or public.is_admin())
  order by 5 desc nulls last;
end;
$$;

revoke all on function public.my_inbox() from public, anon, service_role;
grant execute on function public.my_inbox() to authenticated;

create or replace function public.admin_open_threads()
returns table (
  thread_id uuid,
  kind text,
  label text,
  unread integer,
  last_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return;
  end if;

  return query
  select
    threads.id,
    threads.kind,
    case
      when threads.kind = 'support' then 'Support · ' || split_part(coalesce(profiles.full_name, 'Pickuply'), ' ', 1)
      else 'Job in ' || left(coalesce(jobs.pickup_area, 'the service area'), 80)
    end,
    (
      select count(*)::integer
      from public.messages
      where messages.thread_id = threads.id
        and messages.sender_id is distinct from auth.uid()
        and messages.created_at > coalesce(
          (
            select message_reads.last_read_at
            from public.message_reads
            where message_reads.thread_id = threads.id
              and message_reads.profile_id = auth.uid()
          ),
          '-infinity'::timestamptz
        )
    ),
    (
      select max(messages.created_at)
      from public.messages
      where messages.thread_id = threads.id
    )
  from public.message_threads threads
  left join public.jobs on jobs.id = threads.job_id
  left join public.profiles on profiles.id = threads.requester_id
  where threads.closes_at is null or threads.closes_at > now()
  order by 5 desc nulls last;
end;
$$;

create or replace function public.request_driver_documents(
  target_driver uuid,
  items text[],
  note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_note text := btrim(coalesce(note, ''));
  item_name text;
  thread_id uuid;
  first_item text;
begin
  if not public.is_admin() then
    raise exception 'only an admin can request documents';
  end if;
  if length(clean_note) < 3 then
    raise exception 'add a short note for the driver';
  end if;
  if not exists (select 1 from public.drivers where profile_id = target_driver) then
    raise exception 'driver application not found';
  end if;
  if not exists (
    select 1 from unnest(coalesce(items, array[]::text[])) as item
    where item in ('license', 'services', 'vehicle', 'equipment', 'insurance', 'agreement', 'training')
  ) then
    raise exception 'choose at least one item';
  end if;

  for item_name in
    select distinct item
    from unnest(items) as item
    where item in ('license', 'services', 'vehicle', 'equipment', 'insurance', 'agreement', 'training')
  loop
    insert into public.driver_item_reviews (driver_id, item, note)
    values (target_driver, item_name, clean_note)
    on conflict (driver_id, item) do update
    set note = excluded.note, updated_at = now();
  end loop;

  select item into first_item
  from unnest(items) as item
  where item in ('license', 'services', 'vehicle', 'equipment', 'insurance', 'agreement', 'training')
  limit 1;

  select id into thread_id
  from public.message_threads
  where requester_id = target_driver and kind = 'support';
  if thread_id is null then
    insert into public.message_threads (requester_id, kind)
    values (target_driver, 'support')
    returning id into thread_id;
  end if;
  perform public.post_message(thread_id, clean_note);
  perform public.enqueue_notification(
    target_driver,
    null,
    'driver_documents',
    'Please update your application',
    left(clean_note, 400),
    '/driver/messages?thread=' || thread_id::text || '&upload=' || first_item,
    'driver-docs:' || target_driver::text || ':' || extract(epoch from clock_timestamp())::bigint::text
  );
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'request_driver_documents',
    'driver',
    target_driver,
    jsonb_build_object('items', items, 'note', clean_note, 'thread_id', thread_id)
  );
end;
$$;

create or replace function public.admin_start_message(target_profile uuid, message_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  thread_id uuid;
begin
  if not public.is_admin() then
    raise exception 'only an admin can start this conversation';
  end if;
  if target_profile = auth.uid() or not exists (
    select 1
    from public.profiles
    left join public.drivers on drivers.profile_id = profiles.id
    where profiles.id = target_profile
      and (profiles.role in ('customer', 'driver') or drivers.profile_id is not null)
  ) then
    raise exception 'choose a driver or customer';
  end if;
  select id into thread_id
  from public.message_threads
  where requester_id = target_profile and kind = 'support';
  if thread_id is null then
    insert into public.message_threads (requester_id, kind)
    values (target_profile, 'support')
    returning id into thread_id;
  end if;
  perform public.post_message(thread_id, message_body);
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (auth.uid(), 'admin_start_message', 'profile', target_profile, jsonb_build_object('thread_id', thread_id));
  return thread_id;
end;
$$;

revoke all on function public.admin_start_message(uuid, text) from public, anon, service_role;
grant execute on function public.admin_start_message(uuid, text) to authenticated;

create or replace function public.admin_message_directory()
returns table (
  profile_id uuid,
  label text,
  person_role text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return;
  end if;
  return query
  select
    profiles.id,
    split_part(coalesce(profiles.full_name, 'Pickuply'), ' ', 1)
      || case when drivers.home_city is not null then ' · ' || drivers.home_city else '' end,
    case when drivers.profile_id is not null then 'driver' else profiles.role::text end
  from public.profiles
  left join public.drivers on drivers.profile_id = profiles.id
  where profiles.role in ('customer', 'driver') or drivers.profile_id is not null
  order by 2;
end;
$$;

revoke all on function public.admin_message_directory() from public, anon, service_role;
grant execute on function public.admin_message_directory() to authenticated;

create or replace function public.notify_document_uploaded(item text)
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
  if item not in ('license', 'services', 'vehicle', 'equipment', 'insurance', 'agreement', 'training') then
    raise exception 'choose a document';
  end if;
  perform public.enqueue_notification(
    admin_row.id,
    null,
    'document_uploaded',
    'Document submitted',
    'A driver submitted ' || item || '.',
    '/admin/drivers/' || uid::text,
    'doc-upload:' || uid::text || ':' || item || ':' || extract(epoch from clock_timestamp())::bigint::text
  )
  from public.profiles admin_row
  where admin_row.role = 'admin';
end;
$$;

revoke all on function public.notify_document_uploaded(text) from public, anon, service_role;
grant execute on function public.notify_document_uploaded(text) to authenticated;

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads (id),
  message_id uuid references public.messages (id),
  storage_path text not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.message_attachments enable row level security;

drop policy if exists message_attachments_select on public.message_attachments;
create policy message_attachments_select on public.message_attachments
  for select to authenticated
  using (public.message_participant(thread_id));

revoke all on table public.message_attachments from public, anon, service_role;
grant select on table public.message_attachments to authenticated;

create or replace function public.register_message_file(target_thread uuid, storage_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  message_id uuid;
  clean_path text := btrim(coalesce(storage_path, ''));
begin
  if uid is null or not public.message_participant(target_thread) then
    raise exception 'you cannot add a file here';
  end if;
  if clean_path !~ ('^' || target_thread::text || '/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|pdf)$') then
    raise exception 'choose a photo or PDF';
  end if;
  perform public.post_message(target_thread, 'Sent a file.');
  select messages.id into message_id
  from public.messages
  where messages.thread_id = target_thread and messages.sender_id = uid
  order by messages.created_at desc
  limit 1;
  insert into public.message_attachments (thread_id, message_id, storage_path, created_by)
  values (target_thread, message_id, clean_path, uid);
end;
$$;

revoke all on function public.register_message_file(uuid, text) from public, anon, service_role;
grant execute on function public.register_message_file(uuid, text) to authenticated;

insert into storage.buckets (id, name, public)
values ('message-files', 'message-files', false)
on conflict (id) do update set public = false;

drop policy if exists message_files_bucket_read on storage.buckets;
create policy message_files_bucket_read on storage.buckets
  for select to authenticated
  using (id = 'message-files');

create or replace function public.message_file_allowed(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  folder text;
begin
  folder := (storage.foldername(object_name))[1];
  if folder is null or folder !~ '^[0-9a-f-]{36}$' then
    return false;
  end if;
  return public.message_participant(folder::uuid);
exception
  when invalid_text_representation then
    return false;
end;
$$;

revoke all on function public.message_file_allowed(text) from public, anon, service_role;
grant execute on function public.message_file_allowed(text) to authenticated;

drop policy if exists message_files_participant on storage.objects;
create policy message_files_participant on storage.objects
  for all to authenticated
  using (bucket_id = 'message-files' and public.message_file_allowed(name))
  with check (bucket_id = 'message-files' and public.message_file_allowed(name));
