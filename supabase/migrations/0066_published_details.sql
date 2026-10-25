-- A published request stays open when an admin asks for details.
-- The question goes to Pickuply Support. Pause until updated is optional.

alter table public.messages
  add column action_href text;

alter table public.messages
  add constraint messages_action_href check (
    action_href is null
    or action_href ~ '^/jobs/[0-9a-fA-F-]{36}/edit$'
  );

create or replace function public.jobs_block_quote_while_details_open()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'quoted'
    and new.detail_request is not null
    and new.detail_request->>'answered_at' is null
  then
    raise exception 'wait for the customer to answer before quoting or publishing';
  end if;
  return new;
end;
$$;

create or replace function public.notify_offering_drivers(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  driver uuid;
begin
  for driver in
    select distinct job_offers.driver_id
    from public.job_offers
    where job_offers.job_id = target_job
      and job_offers.status in ('active', 'withdrawn')
  loop
    perform public.enqueue_notification(
      driver,
      target_job,
      'request_updated',
      'Request updated — review your offer',
      'The customer updated this request. Review your offer.',
      '/driver',
      'request-updated:' || target_job::text || ':' || driver::text || ':' || clock_timestamp()::text
    );
  end loop;
end;
$$;

revoke all on function public.notify_offering_drivers(uuid) from public, anon, authenticated, service_role;

drop function if exists public.ask_for_details(uuid, text[], text);

create function public.ask_for_details(
  target_job uuid,
  items text[],
  note text,
  should_pause boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
  clean_items text[];
  clean_note text := left(btrim(coalesce(note, '')), 500);
  labels text;
  body text;
  thread_id uuid;
  asked_at timestamptz := now();
  edit_href text;
begin
  if not public.is_admin() then
    raise exception 'only an admin can ask for details';
  end if;

  select array(
    select distinct item
    from unnest(coalesce(items, array[]::text[])) as item
    where item in ('stairs', 'size', 'pieces', 'item_value', 'access_notes', 'photos')
  ) into clean_items;

  if coalesce(array_length(clean_items, 1), 0) < 1 then
    raise exception 'choose the details you need';
  end if;
  if public.contains_contact(clean_note) then
    raise exception 'remove the phone number or email';
  end if;

  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.status not in ('requested', 'in_review', 'open') then
    raise exception 'this request is no longer waiting for review';
  end if;
  if job_row.assigned_driver_id is not null then
    raise exception 'this request is no longer waiting for review';
  end if;

  edit_href := '/jobs/' || target_job::text || '/edit';

  if should_pause and job_row.status = 'open' then
    perform set_config('pickuply.admin_pause', 'yes', true);
  end if;

  update public.jobs
  set
    paused_at = case
      when should_pause and status = 'open' then coalesce(paused_at, now())
      else paused_at
    end,
    admin_note = nullif(clean_note, ''),
    detail_request = jsonb_build_object(
      'items', to_jsonb(clean_items),
      'note', clean_note,
      'asked_at', asked_at,
      'answered_at', null,
      'paused', should_pause and job_row.status = 'open'
    )
  where id = target_job;

  insert into public.message_threads (requester_id, kind)
  values (job_row.customer_id, 'support')
  on conflict (requester_id) where kind = 'support' do nothing
  returning id into thread_id;

  if thread_id is null then
    select id into thread_id
    from public.message_threads
    where requester_id = job_row.customer_id and kind = 'support';
  end if;

  select string_agg(
    case item
      when 'stairs' then 'stairs'
      when 'size' then 'item size'
      when 'pieces' then 'number of pieces'
      when 'item_value' then 'approximate item value'
      when 'access_notes' then 'access notes'
      when 'photos' then 'another photo'
    end,
    ', '
  ) into labels
  from unnest(clean_items) as item;

  body := left(
    'Please add: ' || labels || case when clean_note = '' then '' else E'\n' || clean_note end,
    1000
  );

  insert into public.messages (thread_id, sender_id, body, body_original, action_href)
  values (thread_id, auth.uid(), body, body, edit_href);

  perform public.enqueue_notification(
    job_row.customer_id,
    target_job,
    'details_requested',
    'A few details needed',
    'Pickuply asked a question about your request.',
    edit_href,
    'details:' || target_job || ':' || asked_at
  );

  insert into public.job_events (job_id, actor_id, type, data)
  values (
    target_job,
    auth.uid(),
    'details_requested',
    jsonb_build_object('items', to_jsonb(clean_items), 'paused', should_pause and job_row.status = 'open')
  );

  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'ask_for_details',
    'job',
    target_job,
    jsonb_build_object(
      'items', to_jsonb(clean_items),
      'note', clean_note,
      'paused', should_pause and job_row.status = 'open'
    )
  );
end;
$$;

revoke all on function public.ask_for_details(uuid, text[], text, boolean) from public, anon, service_role;
grant execute on function public.ask_for_details(uuid, text[], text, boolean) to authenticated;

create or replace function public.answer_detail_request(
  target_job uuid,
  answers jsonb,
  message_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
  clean text := left(btrim(coalesce(message_body, '')), 1000);
  stairs integer;
  dropoff integer;
  piece_count integer;
  value_cents integer;
  item_size text;
  access text;
  changed boolean := false;
  thread_id uuid;
  was_paused boolean;
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;

  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from auth.uid() then
    raise exception 'only the customer can answer';
  end if;
  if job_row.status not in ('requested', 'in_review', 'open')
    or job_row.detail_request is null
    or job_row.detail_request->>'answered_at' is not null
  then
    raise exception 'there is no open question on this request';
  end if;
  if public.contains_contact(clean) then
    raise exception 'remove the phone number or email';
  end if;

  if answers ? 'stairs_pickup' and nullif(answers->>'stairs_pickup', '') is not null then
    stairs := (answers->>'stairs_pickup')::integer;
    if stairs < 0 or stairs > 3 then
      raise exception 'choose the number of stairs';
    end if;
    update public.jobs set stairs_pickup = stairs where id = target_job;
    changed := true;
  end if;

  if answers ? 'stairs_dropoff' and nullif(answers->>'stairs_dropoff', '') is not null then
    dropoff := (answers->>'stairs_dropoff')::integer;
    if dropoff < 0 or dropoff > 3 then
      raise exception 'choose the number of stairs';
    end if;
    update public.jobs set stairs_dropoff = dropoff where id = target_job;
    changed := true;
  end if;

  if answers ? 'size' and nullif(answers->>'size', '') is not null then
    item_size := answers->>'size';
    if item_size not in ('small', 'medium', 'large', 'xl') then
      raise exception 'choose a size';
    end if;
    update public.jobs set size = item_size::public.item_size where id = target_job;
    changed := true;
  end if;

  if answers ? 'pieces' and nullif(answers->>'pieces', '') is not null then
    piece_count := (answers->>'pieces')::integer;
    if piece_count < 1 or piece_count > 100 then
      raise exception 'enter the number of pieces';
    end if;
    update public.jobs set pieces = piece_count where id = target_job;
    changed := true;
  end if;

  if answers ? 'item_value_cents' and nullif(answers->>'item_value_cents', '') is not null then
    value_cents := (answers->>'item_value_cents')::integer;
    if value_cents < 0 or value_cents > 100000000 then
      raise exception 'enter the item value';
    end if;
    update public.jobs
    set item_value_cents = value_cents,
        needs_value_approval = value_cents > 100000
    where id = target_job;
    changed := true;
  end if;

  if answers ? 'access_notes' and nullif(btrim(answers->>'access_notes'), '') is not null then
    access := left(btrim(answers->>'access_notes'), 500);
    if public.contains_contact(access) then
      raise exception 'remove the phone number or email';
    end if;
    update public.job_private set access_notes = access where job_id = target_job;
    changed := true;
  end if;

  if clean = '' and not changed and not exists (
    select 1
    from public.job_photos
    where job_id = target_job
      and stage = 'request'
      and created_at >= (job_row.detail_request->>'asked_at')::timestamptz
  ) then
    raise exception 'add an answer or a short message';
  end if;

  was_paused := coalesce(job_row.detail_request->>'paused', '') = 'true';
  if was_paused then
    perform set_config('pickuply.admin_pause', 'yes', true);
  end if;

  update public.jobs
  set
    status = 'open',
    paused_at = case when was_paused then null else paused_at end,
    admin_note = null,
    detail_request = jsonb_set(
      jsonb_set(detail_request, '{answered_at}', to_jsonb(now())),
      '{paused}',
      'false'::jsonb
    )
  where id = target_job;

  select id into thread_id
  from public.message_threads
  where requester_id = job_row.customer_id and kind = 'support';
  if thread_id is not null then
    insert into public.messages (thread_id, sender_id, body)
    values (
      thread_id,
      auth.uid(),
      case when clean = '' then 'I updated the details you asked for.' else clean end
    );
  end if;

  perform public.notify_admins(
    target_job,
    'details_answered',
    'Details received',
    'The customer answered a question.',
    '/admin/requests/' || target_job,
    'details-answered:' || target_job || ':' || now()
  );

  perform public.notify_offering_drivers(target_job);

  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, auth.uid(), 'details_answered', '{}'::jsonb);
end;
$$;

create or replace function public.messages_return_detail_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  thread public.message_threads%rowtype;
  job_row public.jobs%rowtype;
  was_paused boolean;
begin
  select * into thread from public.message_threads where id = new.thread_id;
  if thread.job_id is null then
    return new;
  end if;

  select * into job_row from public.jobs where id = thread.job_id for update;
  if job_row.customer_id is distinct from new.sender_id
    or job_row.status not in ('requested', 'in_review', 'open')
    or job_row.detail_request is null
    or job_row.detail_request->>'answered_at' is not null
  then
    return new;
  end if;

  was_paused := coalesce(job_row.detail_request->>'paused', '') = 'true';
  if was_paused then
    perform set_config('pickuply.admin_pause', 'yes', true);
  end if;

  update public.jobs
  set
    status = 'open',
    paused_at = case when was_paused then null else paused_at end,
    admin_note = null,
    detail_request = jsonb_set(
      jsonb_set(detail_request, '{answered_at}', to_jsonb(now())),
      '{paused}',
      'false'::jsonb
    )
  where id = job_row.id;

  perform public.notify_admins(
    job_row.id,
    'details_answered',
    'Details received',
    'The customer answered a question.',
    '/admin/requests/' || job_row.id,
    'details-answered:' || job_row.id || ':' || now()
  );

  perform public.notify_offering_drivers(job_row.id);

  insert into public.job_events (job_id, actor_id, type, data)
  values (job_row.id, new.sender_id, 'details_answered', '{}'::jsonb);

  return new;
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
  seen boolean,
  action_href text
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
      ),
    messages.action_href
  from public.messages
  join public.profiles on profiles.id = messages.sender_id
  where messages.thread_id = target_thread
  order by messages.created_at;
end;
$$;

revoke all on function public.thread_messages(uuid) from public, anon, service_role;
grant execute on function public.thread_messages(uuid) to authenticated;
