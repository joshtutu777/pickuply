-- Job chat previews and one-time sends.
-- Adds no price, ledger, or payment change.
-- A retry with the same client key does not insert a second message or a second alert.

alter table public.messages
  add column if not exists client_key text;

create unique index if not exists messages_sender_client_key
  on public.messages (sender_id, client_key)
  where client_key is not null;

create or replace function public.post_message_once(
  target_thread uuid,
  message_body text,
  client_key text
)
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
  if client_key is null or client_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'that message could not be sent';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || client_key, 0));
  if exists (
    select 1
    from public.messages
    where messages.sender_id = uid
      and messages.client_key = post_message_once.client_key
  ) then
    return;
  end if;
  perform public.post_message(target_thread, message_body);
  update public.messages
  set client_key = post_message_once.client_key
  where id = (
    select messages.id
    from public.messages
    where messages.thread_id = target_thread
      and messages.sender_id = uid
      and messages.client_key is null
    order by messages.created_at desc
    limit 1
  );
end;
$$;

revoke all on function public.post_message_once(uuid, text, text) from public, anon, service_role;
grant execute on function public.post_message_once(uuid, text, text) to authenticated;

create or replace function public.message_area_label(area text)
returns text
language sql
immutable
as $$
  select case
    when cleaned = '' or cleaned ~ '^[0-9]' then null
    else cleaned
  end
  from (
    select regexp_replace(split_part(coalesce(area, ''), ',', 1), '\s+[0-9]{5}(-[0-9]{4})?$', '') as cleaned
  ) labels;
$$;

drop function if exists public.my_inbox();

create function public.my_inbox()
returns table (
  thread_id uuid,
  kind text,
  title text,
  unread integer,
  last_at timestamptz,
  participant_name text,
  participant_role text,
  job_label text,
  pickup_label text,
  dropoff_label text,
  job_status text,
  snippet text,
  job_id uuid
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
    ),
    case
      when threads.kind = 'support' then 'Pickuply'
      when threads.driver_id = uid then split_part(coalesce(customer.full_name, 'Customer'), ' ', 1)
      else split_part(coalesce(driver.full_name, 'Driver'), ' ', 1)
    end,
    case
      when threads.kind = 'support' then 'Support'
      when threads.driver_id = uid then 'Customer'
      else 'Driver'
    end,
    case
      when threads.kind = 'support' then null
      else left(
        case jobs.service
          when 'junk' then 'Junk removal'
          when 'free_item' then 'Free-item pickup'
          when 'construction' then 'Store pickup'
          else 'Pickup'
        end
        || case
          when nullif(btrim(coalesce(jobs.description, '')), '') is null then ''
          else ' · ' || left(btrim(jobs.description), 40)
        end,
        80
      )
    end,
    public.message_area_label(jobs.pickup_area),
    public.message_area_label(jobs.dropoff_area),
    jobs.status::text,
    (
      select left(regexp_replace(messages.body, '\s+', ' ', 'g'), 80)
      from public.messages
      where messages.thread_id = threads.id
      order by messages.created_at desc
      limit 1
    ),
    threads.job_id
  from public.message_threads threads
  left join public.jobs on jobs.id = threads.job_id
  left join public.profiles customer on customer.id = threads.requester_id
  left join public.profiles driver on driver.id = threads.driver_id
  where public.message_participant(threads.id)
    and (threads.requester_id = uid or threads.driver_id = uid or public.is_admin())
  order by 5 desc nulls last;
end;
$$;

revoke all on function public.my_inbox() from public, anon, service_role;
grant execute on function public.my_inbox() to authenticated;

create or replace function public.job_message_summary(target_job uuid)
returns table (
  thread_id uuid,
  participant_name text,
  participant_role text,
  unread integer,
  snippet text,
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
    case
      when threads.driver_id = uid then split_part(coalesce(customer.full_name, 'Customer'), ' ', 1)
      else split_part(coalesce(driver.full_name, 'Driver'), ' ', 1)
    end,
    case when threads.driver_id = uid then 'Customer' else 'Driver' end,
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
      select left(regexp_replace(messages.body, '\s+', ' ', 'g'), 80)
      from public.messages
      where messages.thread_id = threads.id
      order by messages.created_at desc
      limit 1
    ),
    (
      select max(messages.created_at)
      from public.messages
      where messages.thread_id = threads.id
    )
  from public.message_threads threads
  join public.profiles customer on customer.id = threads.requester_id
  join public.profiles driver on driver.id = threads.driver_id
  where threads.job_id = target_job
    and threads.kind = 'job'
    and public.message_participant(threads.id);
end;
$$;

revoke all on function public.job_message_summary(uuid) from public, anon, service_role;
grant execute on function public.job_message_summary(uuid) to authenticated;

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
  object_size bigint;
  object_type text;
begin
  if uid is null or not public.message_participant(target_thread) then
    raise exception 'you cannot add a file here';
  end if;
  if clean_path !~ ('^' || target_thread::text || '/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|pdf)$') then
    raise exception 'choose a photo or PDF';
  end if;
  select
    nullif(objects.metadata->>'size', '')::bigint,
    lower(coalesce(objects.metadata->>'mimetype', ''))
  into object_size, object_type
  from storage.objects
  where objects.bucket_id = 'message-files'
    and objects.name = clean_path;
  if object_size is null or object_size < 1 or object_size > 5000000 then
    raise exception 'choose a photo or PDF under 5 MB';
  end if;
  if object_type <> '' and object_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
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

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'messages'
     ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
