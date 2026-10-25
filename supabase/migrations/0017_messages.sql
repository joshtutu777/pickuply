-- Job messages and support threads.
-- A thread opens when a driver is assigned and closes 24 hours after completion.
-- Do not apply this file to the hosted project until the owner approves it.

alter table public.platform_settings
  add column support_phone text,
  add column support_email text;

alter table public.platform_settings
  add constraint platform_settings_support_phone check (
    support_phone is null or support_phone ~ '^\+1[0-9]{10}$'
  ),
  add constraint platform_settings_support_email check (
    support_email is null or support_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  );

create table public.message_threads (
  id uuid primary key default gen_random_uuid(),
  job_id uuid unique references public.jobs (id) on delete cascade,
  requester_id uuid not null references public.profiles (id),
  driver_id uuid references public.profiles (id),
  kind text not null check (kind in ('job', 'support')),
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  constraint message_threads_shape check (
    (kind = 'job' and job_id is not null and driver_id is not null)
    or (kind = 'support' and job_id is null and driver_id is null)
  )
);

create unique index message_threads_one_support
  on public.message_threads (requester_id)
  where kind = 'support';

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_body_length check (char_length(btrim(body)) between 1 and 1000)
);

create index messages_thread_created_idx on public.messages (thread_id, created_at);

create table public.message_reads (
  thread_id uuid not null references public.message_threads (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, profile_id)
);

alter table public.message_threads enable row level security;
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;

create or replace function public.message_participant(target_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.message_threads
    where id = target_thread
      and (
        public.is_admin()
        or requester_id = auth.uid()
        or driver_id = auth.uid()
      )
  );
$$;

revoke all on function public.message_participant(uuid) from public, anon, service_role;
grant execute on function public.message_participant(uuid) to authenticated;

create policy message_threads_select_participant on public.message_threads
  for select to authenticated
  using (public.message_participant(id));

create policy messages_select_participant on public.messages
  for select to authenticated
  using (public.message_participant(thread_id));

create policy message_reads_select_own on public.message_reads
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

grant select on public.message_threads to authenticated;
grant select on public.messages to authenticated;
grant select on public.message_reads to authenticated;

create or replace function public.ensure_job_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_driver_id is not null then
    insert into public.message_threads (job_id, requester_id, driver_id, kind)
    values (new.id, new.customer_id, new.assigned_driver_id, 'job')
    on conflict (job_id) do update
    set driver_id = excluded.driver_id;
  end if;

  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.message_threads
    set closes_at = now() + interval '24 hours'
    where job_id = new.id;
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.message_threads
    set closes_at = now()
    where job_id = new.id;
  end if;

  return new;
end;
$$;

create trigger jobs_ensure_thread
  after update of assigned_driver_id, status on public.jobs
  for each row execute function public.ensure_job_thread();

create or replace function public.contains_contact(value text)
returns boolean
language sql
immutable
as $$
  select value ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
    or value ~ '\+1[0-9]{10}'
    or value ~ '[0-9]{3}[^0-9][0-9]{3}[^0-9][0-9]{4}'
    or value ~ '(^|[^0-9])[0-9]{10}([^0-9]|$)';
$$;

create or replace function public.job_thread(target_job uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select threads.id
  from public.message_threads threads
  where threads.job_id = target_job
    and public.message_participant(threads.id);
$$;

revoke all on function public.job_thread(uuid) from public, anon, service_role;
grant execute on function public.job_thread(uuid) to authenticated;

create or replace function public.thread_messages(target_thread uuid)
returns table (
  id uuid,
  body text,
  created_at timestamptz,
  mine boolean,
  sender_name text
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
    messages.body,
    messages.created_at,
    messages.sender_id = auth.uid(),
    case
      when messages.sender_id = auth.uid() then 'You'
      when profiles.role = 'admin' then 'Pickuply'
      else split_part(coalesce(profiles.full_name, 'Pickuply'), ' ', 1)
    end
  from public.messages
  join public.profiles on profiles.id = messages.sender_id
  where messages.thread_id = target_thread
  order by messages.created_at;
end;
$$;

revoke all on function public.thread_messages(uuid) from public, anon, service_role;
grant execute on function public.thread_messages(uuid) to authenticated;

create or replace function public.mark_thread_read(target_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.message_participant(target_thread) then
    return;
  end if;
  insert into public.message_reads (thread_id, profile_id, last_read_at)
  values (target_thread, auth.uid(), now())
  on conflict (thread_id, profile_id) do update
  set last_read_at = now();
end;
$$;

revoke all on function public.mark_thread_read(uuid) from public, anon, service_role;
grant execute on function public.mark_thread_read(uuid) to authenticated;

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
  message_id uuid;
  area text;
  recipient uuid;
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
  if public.contains_contact(clean) then
    raise exception 'remove the phone number or email';
  end if;

  select * into thread from public.message_threads where id = target_thread;
  if thread.closes_at is not null and thread.closes_at <= now() then
    raise exception 'this conversation is closed';
  end if;

  insert into public.messages (thread_id, sender_id, body)
  values (target_thread, uid, clean)
  returning id into message_id;

  perform public.mark_thread_read(target_thread);

  if thread.job_id is not null then
    select left(pickup_area, 80) into area from public.jobs where id = thread.job_id;
  end if;

  if thread.requester_id is distinct from uid then
    perform public.enqueue_notification(
      thread.requester_id, thread.job_id, 'new_message', 'New message',
      'You have a new message.',
      case when thread.kind = 'job' then '/jobs/' || thread.job_id else '/support' end,
      'message:' || message_id
    );
  end if;

  if thread.driver_id is not null and thread.driver_id is distinct from uid then
    perform public.enqueue_notification(
      thread.driver_id, thread.job_id, 'new_message', 'New message',
      'You have a new message.',
      '/driver/jobs/' || thread.job_id,
      'message:' || message_id
    );
  end if;

  for recipient in select id from public.profiles where role = 'admin' and id is distinct from uid loop
    perform public.enqueue_notification(
      recipient, thread.job_id, 'new_message', 'New message',
      case
        when thread.kind = 'support' then 'New support message.'
        else 'New message on a job in ' || coalesce(area, 'the service area') || '.'
      end,
      '/admin/messages/' || target_thread,
      'message:' || message_id
    );
  end loop;
end;
$$;

revoke all on function public.post_message(uuid, text) from public, anon, service_role;
grant execute on function public.post_message(uuid, text) to authenticated;

create or replace function public.open_support_thread()
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
  insert into public.message_threads (requester_id, kind)
  values (uid, 'support')
  on conflict (requester_id) where kind = 'support'
  do nothing
  returning id into thread_id;

  if thread_id is null then
    select id into thread_id
    from public.message_threads
    where requester_id = uid and kind = 'support';
  end if;
  return thread_id;
end;
$$;

revoke all on function public.open_support_thread() from public, anon, service_role;
grant execute on function public.open_support_thread() to authenticated;

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
      when threads.kind = 'support' then 'Support'
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
  where threads.closes_at is null or threads.closes_at > now()
  order by 5 desc nulls last;
end;
$$;

revoke all on function public.admin_open_threads() from public, anon, service_role;
grant execute on function public.admin_open_threads() to authenticated;

create or replace function public.set_support_contact(phone text, email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_phone text := nullif(btrim(coalesce(phone, '')), '');
  clean_email text := nullif(btrim(coalesce(email, '')), '');
begin
  if not public.is_admin() then
    raise exception 'only an admin can change settings';
  end if;
  if clean_phone is not null and clean_phone !~ '^\+1[0-9]{10}$' then
    raise exception 'enter a US support phone as +1 and 10 digits';
  end if;
  if clean_email is not null and clean_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'enter a valid support email';
  end if;
  update public.platform_settings
  set support_phone = clean_phone,
      support_email = clean_email,
      updated_at = now()
  where id = 1;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'set_support_contact',
    'platform_settings',
    null,
    jsonb_build_object('has_phone', clean_phone is not null, 'has_email', clean_email is not null)
  );
end;
$$;

revoke all on function public.set_support_contact(text, text) from public, anon, service_role;
grant execute on function public.set_support_contact(text, text) to authenticated;
