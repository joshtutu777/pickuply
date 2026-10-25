-- Beta feedback from signed-in customers and drivers.
-- Admin notes live in a separate table so a person cannot read them on their own row.
-- Screenshots are not accepted in this version. attachment_path stays empty.
-- Local only until the owner applies it to the hosted database.

create table public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  user_role text not null,
  feedback_type text not null,
  subject text not null,
  description text not null,
  page_path text not null,
  app_version text,
  device_info text,
  attachment_path text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint beta_feedback_role check (user_role in ('customer', 'driver', 'admin')),
  constraint beta_feedback_type check (feedback_type in ('bug', 'feature', 'confusing', 'general')),
  constraint beta_feedback_status check (status in ('new', 'under_review', 'planned', 'resolved', 'closed')),
  constraint beta_feedback_subject check (char_length(subject) between 3 and 120),
  constraint beta_feedback_description check (char_length(description) between 10 and 4000),
  constraint beta_feedback_page check (
    page_path ~ '^/[A-Za-z0-9/_-]{0,179}$'
    and page_path !~ '^//'
    and page_path !~ '\.\.'
  ),
  constraint beta_feedback_version check (app_version is null or char_length(app_version) <= 40),
  constraint beta_feedback_device check (device_info is null or char_length(device_info) <= 160)
);

create index beta_feedback_status_idx on public.beta_feedback (status, created_at desc);
create index beta_feedback_user_idx on public.beta_feedback (user_id, created_at desc);

create table public.beta_feedback_notes (
  feedback_id uuid primary key references public.beta_feedback (id) on delete cascade,
  body text not null,
  updated_at timestamptz not null default now(),
  constraint beta_feedback_notes_body check (char_length(body) between 1 and 4000)
);

alter table public.beta_feedback enable row level security;
alter table public.beta_feedback_notes enable row level security;

create policy beta_feedback_select on public.beta_feedback
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy beta_feedback_notes_select on public.beta_feedback_notes
  for select to authenticated
  using (public.is_admin());

revoke all on table public.beta_feedback from public, anon, authenticated, service_role;
revoke all on table public.beta_feedback_notes from public, anon, authenticated, service_role;
grant select on table public.beta_feedback to authenticated;
grant select on table public.beta_feedback_notes to authenticated;

create or replace function public.submit_beta_feedback(
  kind text,
  subject_text text,
  details text,
  page_text text,
  version_text text,
  device_text text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  role_name text;
  clean_subject text := btrim(coalesce(subject_text, ''));
  clean_details text := btrim(coalesce(details, ''));
  clean_page text := btrim(coalesce(page_text, ''));
  clean_version text := nullif(left(btrim(coalesce(version_text, '')), 40), '');
  clean_device text := nullif(left(regexp_replace(coalesce(device_text, ''), '[[:cntrl:]]', '', 'g'), 160), '');
  feedback_id uuid;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select role::text into role_name from public.profiles where id = uid;
  if role_name is null or role_name not in ('customer', 'driver', 'admin') then
    raise exception 'sign in required';
  end if;
  if kind not in ('bug', 'feature', 'confusing', 'general') then
    raise exception 'Choose a feedback type.';
  end if;
  if char_length(clean_subject) < 3 or char_length(clean_subject) > 120 then
    raise exception 'Subject must be 3 to 120 characters.';
  end if;
  if char_length(clean_details) < 10 or char_length(clean_details) > 4000 then
    raise exception 'Details must be 10 to 4000 characters.';
  end if;
  if clean_page !~ '^/[A-Za-z0-9/_-]{0,179}$' or clean_page like '//%' or position('..' in clean_page) > 0 then
    clean_page := '/feedback';
  end if;
  if (
    select count(*)
    from public.beta_feedback
    where user_id = uid
      and created_at > now() - interval '1 hour'
  ) >= 8 then
    raise exception 'Please wait before sending more feedback.';
  end if;
  if exists (
    select 1
    from public.beta_feedback
    where user_id = uid
      and feedback_type = kind
      and subject = clean_subject
      and description = clean_details
      and created_at > now() - interval '10 minutes'
  ) then
    raise exception 'You already sent this feedback.';
  end if;

  insert into public.beta_feedback (
    user_id, user_role, feedback_type, subject, description, page_path, app_version, device_info, status
  ) values (
    uid, role_name, kind, clean_subject, clean_details, clean_page, clean_version, nullif(btrim(clean_device), ''), 'new'
  )
  returning id into feedback_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    uid,
    'submit_beta_feedback',
    'beta_feedback',
    feedback_id,
    jsonb_build_object('feedback_type', kind, 'page_path', clean_page)
  );
  return feedback_id;
end;
$$;

revoke all on function public.submit_beta_feedback(text, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.submit_beta_feedback(text, text, text, text, text, text) to authenticated;

create or replace function public.review_beta_feedback(
  target_id uuid,
  next_status text,
  notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_notes text := nullif(btrim(coalesce(notes, '')), '');
begin
  if not public.is_admin() then
    raise exception 'only an admin can review feedback';
  end if;
  if next_status not in ('new', 'under_review', 'planned', 'resolved', 'closed') then
    raise exception 'choose a status';
  end if;
  if clean_notes is not null and char_length(clean_notes) > 4000 then
    raise exception 'notes are too long';
  end if;
  update public.beta_feedback
  set status = next_status,
      updated_at = now(),
      resolved_at = case
        when next_status in ('resolved', 'closed') then coalesce(resolved_at, now())
        else null
      end
  where id = target_id;
  if not found then
    raise exception 'feedback not found';
  end if;
  if clean_notes is null then
    delete from public.beta_feedback_notes where feedback_id = target_id;
  else
    insert into public.beta_feedback_notes (feedback_id, body, updated_at)
    values (target_id, clean_notes, now())
    on conflict (feedback_id) do update
      set body = excluded.body,
          updated_at = now();
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (auth.uid(), 'review_beta_feedback', 'beta_feedback', target_id, jsonb_build_object('status', next_status));
end;
$$;

revoke all on function public.review_beta_feedback(uuid, text, text) from public, anon, service_role;
grant execute on function public.review_beta_feedback(uuid, text, text) to authenticated;

create or replace function public.beta_feedback_counts()
returns table (
  total_count bigint,
  new_count bigint,
  under_review_count bigint,
  planned_count bigint,
  resolved_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can read feedback';
  end if;
  return query
  select
    count(*)::bigint,
    count(*) filter (where status = 'new')::bigint,
    count(*) filter (where status = 'under_review')::bigint,
    count(*) filter (where status = 'planned')::bigint,
    count(*) filter (where status = 'resolved')::bigint
  from public.beta_feedback;
end;
$$;

revoke all on function public.beta_feedback_counts() from public, anon, service_role;
grant execute on function public.beta_feedback_counts() to authenticated;

create or replace function public.list_beta_feedback(
  status_filter text,
  type_filter text,
  role_filter text,
  from_date date,
  to_date date,
  search text,
  page_size integer,
  page_offset integer
)
returns table (
  id uuid,
  created_at timestamptz,
  user_role text,
  full_name text,
  feedback_type text,
  subject text,
  status text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  clean_search text := nullif(left(replace(replace(btrim(coalesce(search, '')), '%', ''), '_', ''), 80), '');
  clean_size integer := least(greatest(coalesce(page_size, 20), 1), 50);
  clean_offset integer := greatest(coalesce(page_offset, 0), 0);
begin
  if not public.is_admin() then
    raise exception 'only an admin can read feedback';
  end if;
  return query
  select
    row.id,
    row.created_at,
    row.user_role,
    row.full_name,
    row.feedback_type,
    row.subject,
    row.status,
    count(*) over ()
  from (
    select
      feedback.id,
      feedback.created_at,
      feedback.user_role,
      profiles.full_name,
      feedback.feedback_type,
      feedback.subject,
      feedback.status
    from public.beta_feedback as feedback
    join public.profiles as profiles on profiles.id = feedback.user_id
    where (status_filter is null or status_filter = '' or feedback.status = status_filter)
      and (type_filter is null or type_filter = '' or feedback.feedback_type = type_filter)
      and (role_filter is null or role_filter = '' or feedback.user_role = role_filter)
      and (from_date is null or feedback.created_at >= from_date::timestamptz)
      and (to_date is null or feedback.created_at < (to_date + 1)::timestamptz)
      and (
        clean_search is null
        or feedback.subject ilike '%' || clean_search || '%'
        or profiles.full_name ilike '%' || clean_search || '%'
      )
  ) as row
  order by row.created_at desc
  limit clean_size
  offset clean_offset;
end;
$$;

revoke all on function public.list_beta_feedback(text, text, text, date, date, text, integer, integer) from public, anon, service_role;
grant execute on function public.list_beta_feedback(text, text, text, date, date, text, integer, integer) to authenticated;

create or replace function public.read_beta_feedback(target_id uuid)
returns table (
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz,
  user_role text,
  full_name text,
  feedback_type text,
  subject text,
  description text,
  page_path text,
  app_version text,
  device_info text,
  status text,
  admin_notes text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can read feedback';
  end if;
  return query
  select
    feedback.id,
    feedback.created_at,
    feedback.updated_at,
    feedback.resolved_at,
    feedback.user_role,
    profiles.full_name,
    feedback.feedback_type,
    feedback.subject,
    feedback.description,
    feedback.page_path,
    feedback.app_version,
    feedback.device_info,
    feedback.status,
    notes.body
  from public.beta_feedback as feedback
  join public.profiles as profiles on profiles.id = feedback.user_id
  left join public.beta_feedback_notes as notes on notes.feedback_id = feedback.id
  where feedback.id = target_id;
end;
$$;

revoke all on function public.read_beta_feedback(uuid) from public, anon, service_role;
grant execute on function public.read_beta_feedback(uuid) to authenticated;
