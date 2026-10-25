-- An admin can ask for missing details. Quoting and publishing stay blocked
-- until the customer answers. A job message thread can exist before a driver
-- is assigned so the customer can reply on the request.

alter table public.jobs
  add column detail_request jsonb;

alter table public.jobs
  add constraint jobs_detail_request_shape check (
    detail_request is null
    or (
      jsonb_typeof(detail_request->'items') = 'array'
      and jsonb_array_length(detail_request->'items') between 1 and 6
    )
  );

alter table public.message_threads drop constraint message_threads_shape;
alter table public.message_threads add constraint message_threads_shape check (
  (kind = 'job' and job_id is not null)
  or (kind = 'support' and job_id is null and driver_id is null)
);

create or replace function public.jobs_block_quote_while_details_open()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('quoted', 'open')
    and new.detail_request is not null
    and new.detail_request->>'answered_at' is null
  then
    raise exception 'wait for the customer to answer before quoting or publishing';
  end if;
  return new;
end;
$$;

create trigger jobs_block_quote_while_details_open
  before update of status on public.jobs
  for each row execute function public.jobs_block_quote_while_details_open();

create or replace function public.ask_for_details(
  target_job uuid,
  items text[],
  note text
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
  if not found or job_row.status not in ('requested', 'in_review') then
    raise exception 'this request is no longer waiting for review';
  end if;

  update public.jobs
  set
    status = 'in_review',
    admin_note = nullif(clean_note, ''),
    detail_request = jsonb_build_object(
      'items', to_jsonb(clean_items),
      'note', clean_note,
      'asked_at', asked_at,
      'answered_at', null
    )
  where id = target_job;

  insert into public.message_threads (job_id, requester_id, kind)
  values (target_job, job_row.customer_id, 'job')
  on conflict (job_id) do nothing
  returning id into thread_id;

  if thread_id is null then
    select id into thread_id from public.message_threads where job_id = target_job;
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

  body := left('Please add: ' || labels || case when clean_note = '' then '' else E'\n' || clean_note end, 1000);

  insert into public.messages (thread_id, sender_id, body)
  values (thread_id, auth.uid(), body);

  perform public.enqueue_notification(
    job_row.customer_id,
    target_job,
    'details_requested',
    'A few details needed',
    'Pickuply asked a question about your request.',
    '/jobs/' || target_job,
    'details:' || target_job || ':' || asked_at
  );

  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, auth.uid(), 'details_requested', jsonb_build_object('items', to_jsonb(clean_items)));

  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'ask_for_details',
    'job',
    target_job,
    jsonb_build_object('items', to_jsonb(clean_items), 'note', clean_note)
  );
end;
$$;

revoke all on function public.ask_for_details(uuid, text[], text) from public, anon, service_role;
grant execute on function public.ask_for_details(uuid, text[], text) to authenticated;

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
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;

  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from auth.uid() then
    raise exception 'only the customer can answer';
  end if;
  if job_row.status not in ('requested', 'in_review')
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

  update public.jobs
  set
    status = 'requested',
    admin_note = null,
    detail_request = jsonb_set(detail_request, '{answered_at}', to_jsonb(now()))
  where id = target_job;

  select id into thread_id from public.message_threads where job_id = target_job;
  if thread_id is not null then
    insert into public.messages (thread_id, sender_id, body)
    values (thread_id, auth.uid(), case when clean = '' then 'I updated the details you asked for.' else clean end);
  end if;

  perform public.notify_admins(
    target_job,
    'details_answered',
    'Details received',
    'The customer answered a question.',
    '/admin/requests/' || target_job,
    'details-answered:' || target_job || ':' || now()
  );

  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, auth.uid(), 'details_answered', '{}'::jsonb);
end;
$$;

revoke all on function public.answer_detail_request(uuid, jsonb, text) from public, anon, service_role;
grant execute on function public.answer_detail_request(uuid, jsonb, text) to authenticated;

create or replace function public.open_detail_request(target_job uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
begin
  select * into job_row from public.jobs where id = target_job;
  if not found
    or job_row.detail_request is null
    or job_row.detail_request->>'answered_at' is not null
  then
    return null;
  end if;
  if not (public.is_admin() or job_row.customer_id = auth.uid()) then
    return null;
  end if;
  return jsonb_build_object(
    'items', job_row.detail_request->'items',
    'note', coalesce(job_row.detail_request->>'note', '')
  );
end;
$$;

revoke all on function public.open_detail_request(uuid) from public, anon, service_role;
grant execute on function public.open_detail_request(uuid) to authenticated;

create or replace function public.messages_return_detail_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  thread public.message_threads%rowtype;
  job_row public.jobs%rowtype;
begin
  select * into thread from public.message_threads where id = new.thread_id;
  if thread.job_id is null then
    return new;
  end if;

  select * into job_row from public.jobs where id = thread.job_id for update;
  if job_row.customer_id is distinct from new.sender_id
    or job_row.status not in ('requested', 'in_review')
    or job_row.detail_request is null
    or job_row.detail_request->>'answered_at' is not null
  then
    return new;
  end if;

  update public.jobs
  set
    status = 'requested',
    admin_note = null,
    detail_request = jsonb_set(detail_request, '{answered_at}', to_jsonb(now()))
  where id = job_row.id;

  perform public.notify_admins(
    job_row.id,
    'details_answered',
    'Details received',
    'The customer answered a question.',
    '/admin/requests/' || job_row.id,
    'details-answered:' || job_row.id || ':' || now()
  );

  insert into public.job_events (job_id, actor_id, type, data)
  values (job_row.id, new.sender_id, 'details_answered', '{}'::jsonb);

  return new;
end;
$$;

create trigger messages_return_detail_request
  after insert on public.messages
  for each row execute function public.messages_return_detail_request();

create or replace function public.attach_request_photo(
  target_job_id uuid,
  target_path text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  existing_id uuid;
  existing_job uuid;
  existing_stage public.photo_stage;
  existing_uploader uuid;
  inserted_id uuid;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if target_job_id is null or target_path is null then
    raise exception 'photo path is required';
  end if;
  if target_path !~ (
    '^' || target_job_id::text || '/request/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.jpg$'
  ) then
    raise exception 'invalid photo path';
  end if;
  if not exists (
    select 1
    from public.jobs
    where id = target_job_id
      and customer_id = uid
      and (
        status = 'requested'
        or (
          status = 'in_review'
          and detail_request is not null
          and detail_request->>'answered_at' is null
          and detail_request->'items' ? 'photos'
        )
      )
  ) then
    raise exception 'request not found';
  end if;

  select id, job_id, stage, uploaded_by
  into existing_id, existing_job, existing_stage, existing_uploader
  from public.job_photos
  where storage_path = target_path;

  if existing_id is not null then
    if existing_job = target_job_id
      and existing_stage = 'request'
      and existing_uploader = uid then
      return existing_id;
    end if;
    raise exception 'photo path is already used';
  end if;

  begin
    insert into public.job_photos (job_id, stage, storage_path, uploaded_by)
    values (target_job_id, 'request', target_path, uid)
    returning id into inserted_id;
  exception
    when unique_violation then
      select id into inserted_id
      from public.job_photos
      where storage_path = target_path
        and job_id = target_job_id
        and stage = 'request'
        and uploaded_by = uid;
      if inserted_id is null then
        raise exception 'photo path is already used';
      end if;
  end;

  return inserted_id;
end;
$function$;
