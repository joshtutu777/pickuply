-- Close a job chat as soon as the job is completed or cancelled.
-- Reject phone numbers and emails instead of saving a redacted copy.
-- An admin may include contact details only in a support thread.

create or replace function public.contains_contact(value text)
returns boolean
language plpgsql
immutable
as $$
declare
  normalized text := lower(coalesce(value, ''));
  digits text := '';
  before_text text := '';
  saw_separator boolean := false;
  split_at integer := null;
  i integer;
  ch text;
  long_order boolean;
  blocked boolean;
begin
  normalized := regexp_replace(normalized, '\(\s*at\s*\)', '@', 'g');
  normalized := regexp_replace(normalized, '\s*\mat\M\s*', '@', 'g');
  normalized := regexp_replace(normalized, '\(\s*dot\s*\)', '.', 'g');
  normalized := regexp_replace(normalized, '\s*\mdot\M\s*', '.', 'g');
  normalized := regexp_replace(normalized, '\mzero\M', '0', 'g');
  normalized := regexp_replace(normalized, '\mone\M', '1', 'g');
  normalized := regexp_replace(normalized, '\mtwo\M', '2', 'g');
  normalized := regexp_replace(normalized, '\mthree\M', '3', 'g');
  normalized := regexp_replace(normalized, '\mfour\M', '4', 'g');
  normalized := regexp_replace(normalized, '\mfive\M', '5', 'g');
  normalized := regexp_replace(normalized, '\msix\M', '6', 'g');
  normalized := regexp_replace(normalized, '\mseven\M', '7', 'g');
  normalized := regexp_replace(normalized, '\meight\M', '8', 'g');
  normalized := regexp_replace(normalized, '\mnine\M', '9', 'g');

  if normalized ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then
    return true;
  end if;

  for i in 1..length(normalized) loop
    ch := substr(normalized, i, 1);
    if ch ~ '[0-9]' then
      if digits = '' then
        before_text := substr(normalized, 1, i - 1);
      end if;
      if saw_separator and split_at is null then
        split_at := length(digits);
      end if;
      digits := digits || ch;
      saw_separator := false;
    elsif position(ch in E' \t\n\r().-+') > 0 then
      if digits <> '' then
        saw_separator := true;
      end if;
    else
      long_order := length(digits) = 10 or (length(digits) = 11 and left(digits, 1) = '1');
      blocked := length(digits) = 10
        or (length(digits) = 11 and left(digits, 1) = '1')
        or (length(digits) = 7 and split_at = 3)
        or (length(digits) = 6 and split_at = 3);
      if blocked and not (
        long_order
        and before_text ~ '\m(order|pickup|confirmation|po)\M([\s#:.-]*(number|no|num)\M)?[\s#:.-]*[a-z]{0,8}[\s#:.-]*$'
      ) then
        return true;
      end if;
      digits := '';
      saw_separator := false;
      split_at := null;
    end if;
  end loop;

  long_order := length(digits) = 10 or (length(digits) = 11 and left(digits, 1) = '1');
  blocked := length(digits) = 10
    or (length(digits) = 11 and left(digits, 1) = '1')
    or (length(digits) = 7 and split_at = 3)
    or (length(digits) = 6 and split_at = 3);
  return blocked and not (
    long_order
    and before_text ~ '\m(order|pickup|confirmation|po)\M([\s#:.-]*(number|no|num)\M)?[\s#:.-]*[a-z]{0,8}[\s#:.-]*$'
  );
end;
$$;

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

  if new.status in ('completed', 'cancelled') and old.status is distinct from new.status then
    update public.message_threads
    set closes_at = now()
    where job_id = new.id;
  end if;

  return new;
end;
$$;

update public.message_threads threads
set closes_at = now()
from public.jobs
where jobs.id = threads.job_id
  and threads.kind = 'job'
  and jobs.status in ('completed', 'cancelled')
  and (threads.closes_at is null or threads.closes_at > now());

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
  if public.contains_contact(clean)
     and not (thread.kind = 'support' and public.is_admin()) then
    raise exception 'For your safety, contact details can''t be shared in chat';
  end if;

  insert into public.messages (thread_id, sender_id, body, body_original)
  values (target_thread, uid, clean, clean)
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
  support_admin boolean;
begin
  if uid is null or not public.message_participant(target_thread) then
    raise exception 'you cannot add a file here';
  end if;
  select threads.kind = 'support' and public.is_admin()
    into support_admin
  from public.message_threads threads
  where threads.id = target_thread;
  if public.contains_contact(clean_path) and not coalesce(support_admin, false) then
    raise exception 'For your safety, contact details can''t be shared in chat';
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
