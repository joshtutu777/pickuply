-- Approve driver marks the vehicle eligible and notifies the driver.
-- Customers cannot start a support thread. Job chat closes when the job ends.
-- Chat stores the original for admins and shows everyone else a redacted copy.
-- Local only until the owner applies it to the hosted database.

alter table public.messages
  add column body_original text;

revoke select on table public.messages from authenticated;
grant select (id, thread_id, sender_id, body, created_at) on table public.messages to authenticated;

alter table public.message_threads
  add column resolved_at timestamptz;

create or replace function public.redact_contact(value text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(value, ''),
          '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[contact info hidden]', 'gi'),
        '\+1[0-9]{10}', '[contact info hidden]', 'g'),
      '[0-9]{3}[^0-9][0-9]{3}[^0-9][0-9]{4}', '[contact info hidden]', 'g'),
    '(^|[^0-9])[0-9]{10}([^0-9]|$)', '\1[contact info hidden]\2', 'g');
$$;

revoke all on function public.redact_contact(text) from public, anon, service_role;
grant execute on function public.redact_contact(text) to authenticated;

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
    end
  from public.messages
  join public.profiles on profiles.id = messages.sender_id
  where messages.thread_id = target_thread
  order by messages.created_at;
end;
$$;

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
      case when thread.kind = 'job' then '/jobs/' || thread.job_id else '/support' end,
      'message:' || message_id
    );
  end if;

  if thread.driver_id is not null and thread.driver_id is distinct from uid then
    perform public.enqueue_notification(
      thread.driver_id, thread.job_id, 'new_message', 'New message',
      'You have a new message.',
      case when thread.kind = 'job' then '/driver/jobs/' || thread.job_id else '/support' end,
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
      '/admin/messages/' || target_thread,
      'message:' || message_id || ':' || admin_row.id
    )
    from public.profiles admin_row
    where admin_row.role = 'admin' and admin_row.id is distinct from uid;
  end if;
end;
$$;

create or replace function public.open_support_thread()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  thread_id uuid;
  driver_row boolean;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select exists (select 1 from public.drivers where profile_id = uid) into driver_row;
  select id into thread_id
  from public.message_threads
  where requester_id = uid and kind = 'support';
  if thread_id is null and not driver_row and not public.is_admin() then
    raise exception 'use Help to contact Pickuply';
  end if;
  if thread_id is null then
    insert into public.message_threads (requester_id, kind)
    values (uid, 'support')
    returning id into thread_id;
  end if;
  return thread_id;
end;
$$;

create or replace function public.admin_message_customer(target_customer uuid, message_body text)
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
  if not exists (select 1 from public.profiles where id = target_customer and role = 'customer') then
    raise exception 'choose a customer';
  end if;
  select id into thread_id
  from public.message_threads
  where requester_id = target_customer and kind = 'support';
  if thread_id is null then
    insert into public.message_threads (requester_id, kind)
    values (target_customer, 'support')
    returning id into thread_id;
  end if;
  perform public.post_message(thread_id, message_body);
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (auth.uid(), 'admin_message_customer', 'profile', target_customer, jsonb_build_object('thread_id', thread_id));
  return thread_id;
end;
$$;

revoke all on function public.admin_message_customer(uuid, text) from public, anon, service_role;
grant execute on function public.admin_message_customer(uuid, text) to authenticated;

create or replace function public.mark_support_resolved(target_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can resolve support';
  end if;
  update public.message_threads
  set resolved_at = now()
  where id = target_thread and kind = 'support' and resolved_at is null;
  if not found then
    raise exception 'that support thread is already resolved';
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (auth.uid(), 'resolve_support', 'message_thread', target_thread, '{}'::jsonb);
end;
$$;

revoke all on function public.mark_support_resolved(uuid) from public, anon, service_role;
grant execute on function public.mark_support_resolved(uuid) to authenticated;

create or replace function public.review_driver(
  target_driver uuid,
  decision text,
  note text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  driver_row public.drivers%rowtype;
  next_status public.driver_status;
  next_role public.profile_role;
begin
  if not public.is_admin() then
    raise exception 'only an admin can review drivers';
  end if;
  if decision not in (
    'approve_new', 'approve_active', 'request_changes', 'decline', 'pause', 'remove'
  ) then
    raise exception 'choose a review decision';
  end if;
  if decision in ('request_changes', 'decline', 'pause', 'remove')
    and length(btrim(coalesce(note, ''))) < 3 then
    raise exception 'add a short note for the driver';
  end if;

  select * into driver_row from public.drivers where profile_id = target_driver for update;
  if not found then
    raise exception 'driver application not found';
  end if;

  if decision in ('approve_new', 'approve_active') then
    if driver_row.license_url is null or driver_row.license_expires is null then
      raise exception 'license is required before approval';
    end if;
    if not exists (select 1 from public.vehicles where driver_id = target_driver) then
      raise exception 'a vehicle is required before approval';
    end if;
  end if;

  next_role := case
    when decision in ('approve_new', 'approve_active') then 'driver'::public.profile_role
    when decision in ('decline', 'remove') then 'customer'::public.profile_role
    else null
  end;
  next_status := case decision
    when 'approve_new' then 'approved_new'::public.driver_status
    when 'approve_active' then 'active'::public.driver_status
    when 'request_changes' then 'pending_review'::public.driver_status
    when 'decline' then 'removed'::public.driver_status
    when 'pause' then 'paused'::public.driver_status
    else 'removed'::public.driver_status
  end;

  perform set_config('pickuply.driver_review', 'yes', true);
  update public.drivers
  set
    status = next_status,
    review_note = nullif(btrim(coalesce(note, '')), ''),
    is_online = false
  where profile_id = target_driver;

  if decision in ('approve_new', 'approve_active') then
    perform set_config('pickuply.vehicle_approval', 'yes', true);
    update public.vehicles set approved = true where driver_id = target_driver;
    perform public.enqueue_notification(
      target_driver,
      null,
      'driver_approved',
      'You''re approved',
      'You''re approved! Switch Online whenever you''re ready to see and accept jobs.',
      '/driver',
      'driver-approved:' || target_driver::text
    );
  end if;

  if next_role is not null then
    update public.profiles set role = next_role where id = target_driver;
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'review_driver',
    'driver',
    target_driver,
    jsonb_build_object('decision', decision, 'note', nullif(btrim(coalesce(note, '')), ''))
  );
end;
$function$;

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
    '/driver',
    'driver-docs:' || target_driver::text || ':' || extract(epoch from clock_timestamp())::bigint::text
  );
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'request_driver_documents',
    'driver',
    target_driver,
    jsonb_build_object('items', items, 'note', clean_note)
  );
end;
$$;

revoke all on function public.request_driver_documents(uuid, text[], text) from public, anon, service_role;
grant execute on function public.request_driver_documents(uuid, text[], text) to authenticated;
