-- Proof photos, problem reports, and dispute holds.
-- A report blocks capture and payout creation. It does not move money.
-- The Stripe refund itself waits for Step 5.
-- Do not apply this file to the hosted project until the owner approves it.

alter table public.platform_settings
  add column proof_location_enabled boolean not null default false;

alter table public.jobs
  add column require_disposal_receipt boolean not null default false;

alter table public.job_photos
  add column captured_at timestamptz not null default now(),
  add column note text,
  add column media_kind text not null default 'photo',
  add column report_id uuid;

alter table public.job_photos
  add constraint job_photos_media_kind check (media_kind in ('photo', 'video')),
  add constraint job_photos_note_length check (note is null or char_length(note) <= 300);

create table public.proof_rules (
  service public.job_service primary key,
  pickup_min integer not null,
  pickup_max integer not null,
  dropoff_min integer not null,
  dropoff_max integer not null,
  constraint proof_rules_bounds check (
    pickup_min >= 0 and pickup_max >= pickup_min
    and dropoff_min >= 0 and dropoff_max >= dropoff_min
  )
);

insert into public.proof_rules (service, pickup_min, pickup_max, dropoff_min, dropoff_max)
values
  ('delivery', 1, 3, 1, 1),
  ('free_item', 1, 1, 1, 1),
  ('construction', 1, 1, 1, 1),
  ('junk', 1, 1, 1, 1);

create table public.proof_locations (
  photo_id uuid primary key references public.job_photos (id) on delete cascade,
  approximate_lat numeric(5, 2) not null,
  approximate_lng numeric(6, 2) not null,
  created_at timestamptz not null default now(),
  constraint proof_locations_range check (
    approximate_lat between -90 and 90
    and approximate_lng between -180 and 180
  )
);

create table public.job_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id),
  category text not null,
  description text not null,
  outcome_wanted text not null,
  created_at timestamptz not null default now(),
  constraint job_reports_category check (
    category in ('damaged', 'missing', 'late', 'no_show', 'extra_money', 'unsafe', 'other')
  ),
  constraint job_reports_outcome check (outcome_wanted in ('refund', 'repair', 'apology', 'note')),
  constraint job_reports_description check (char_length(btrim(description)) between 1 and 2000)
);

alter table public.job_photos
  add constraint job_photos_report_fk
  foreign key (report_id) references public.job_reports (id);

create table public.job_disputes (
  job_id uuid primary key references public.jobs (id) on delete cascade,
  report_id uuid not null references public.job_reports (id),
  capture_hold boolean not null default true,
  payout_hold boolean not null default true,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.dispute_resolutions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  admin_id uuid not null references public.profiles (id),
  outcome text not null,
  notes text not null,
  amount_cents integer,
  reason text,
  status text not null default 'recorded',
  release_capture boolean not null,
  release_payout boolean not null,
  created_at timestamptz not null default now(),
  constraint dispute_resolutions_outcome check (
    outcome in ('no_action', 'partial_refund', 'full_refund', 'payout_adjustment', 'driver_warning', 'driver_pause')
  ),
  constraint dispute_resolutions_status check (status = 'recorded'),
  constraint dispute_resolutions_amount check (amount_cents is null or amount_cents >= 0),
  constraint dispute_resolutions_notes check (char_length(btrim(notes)) between 1 and 2000)
);

-- Step 5 records driver payouts here. A dispute hold blocks a new row or a payment.
create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  driver_id uuid not null references public.profiles (id),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'recorded' check (status in ('recorded', 'paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

alter table public.proof_rules enable row level security;
alter table public.proof_locations enable row level security;
alter table public.job_reports enable row level security;
alter table public.job_disputes enable row level security;
alter table public.dispute_resolutions enable row level security;
alter table public.payouts enable row level security;

create policy proof_rules_read on public.proof_rules
  for select to authenticated
  using (true);

create policy proof_locations_admin_read on public.proof_locations
  for select to authenticated
  using (public.is_admin());

create policy job_reports_select_parties on public.job_reports
  for select to authenticated
  using (
    public.is_admin()
    or reporter_id = auth.uid()
    or exists (
      select 1 from public.jobs
      where jobs.id = job_reports.job_id
        and (jobs.customer_id = auth.uid() or jobs.assigned_driver_id = auth.uid())
    )
  );

create policy job_disputes_select_parties on public.job_disputes
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.jobs
      where jobs.id = job_disputes.job_id
        and (jobs.customer_id = auth.uid() or jobs.assigned_driver_id = auth.uid())
    )
  );

create policy dispute_resolutions_admin_read on public.dispute_resolutions
  for select to authenticated
  using (public.is_admin());

create policy payouts_admin_read on public.payouts
  for select to authenticated
  using (public.is_admin());

grant select on public.proof_rules to authenticated;
grant select on public.proof_locations to authenticated;
grant select on public.job_reports to authenticated;
grant select on public.job_disputes to authenticated;
grant select on public.dispute_resolutions to authenticated;
grant select on public.payouts to authenticated;

create policy job_photos_insert_driver_report on public.job_photos
  for insert to authenticated
  with check (
    stage = 'report'
    and public.is_assigned_driver(job_id)
    and uploaded_by = auth.uid()
  );

create policy job_photos_storage_driver_report on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-photos'
    and public.storage_stage(name) = 'report'
    and public.is_assigned_driver(public.storage_job_id(name))
  );

create or replace function public.lock_job_photos()
returns trigger
language plpgsql
as $$
begin
  raise exception 'photos cannot be changed or deleted';
end;
$$;

create trigger job_photos_lock
  before update or delete on public.job_photos
  for each row execute function public.lock_job_photos();

create or replace function public.guard_dispute_money()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_status = 'captured'
    and old.payment_status is distinct from 'captured'
    and exists (
      select 1 from public.job_disputes
      where job_id = new.id and capture_hold
    ) then
    raise exception 'capture is on hold while this job is disputed';
  end if;
  return new;
end;
$$;

create trigger jobs_guard_dispute_money
  before update of payment_status on public.jobs
  for each row execute function public.guard_dispute_money();

create or replace function public.guard_payout_hold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or (new.status = 'paid' and old.status is distinct from 'paid') then
    if exists (
      select 1 from public.job_disputes
      where job_id = new.job_id and payout_hold
    ) then
      raise exception 'payout is on hold while this job is disputed';
    end if;
  end if;
  return new;
end;
$$;

create trigger payouts_guard_hold
  before insert or update of status on public.payouts
  for each row execute function public.guard_payout_hold();

create or replace function public.disposal_receipt_required(target_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select service = 'junk'
    and (coalesce(dump_fee_cents, 0) > 0 or require_disposal_receipt)
  from public.jobs
  where id = target_job;
$$;

revoke all on function public.disposal_receipt_required(uuid) from public, anon, service_role;
grant execute on function public.disposal_receipt_required(uuid) to authenticated;

create or replace function public.record_proof(
  target_job uuid,
  photo_stage text,
  storage_path text,
  photo_note text,
  media_kind text,
  share_location boolean,
  raw_lat numeric,
  raw_lng numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job public.jobs%rowtype;
  rules public.proof_rules%rowtype;
  photo_id uuid;
  stage_count integer;
  stage_max integer;
  location_on boolean;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if photo_stage not in ('pickup', 'dropoff', 'dump_receipt') then
    raise exception 'that proof step is not available';
  end if;
  if media_kind not in ('photo', 'video') then
    raise exception 'choose a photo or a short video';
  end if;
  if storage_path !~ (
    '^' || target_job::text || '/' || photo_stage || '/[0-9a-f-]{36}\.(jpg|jpeg|webp|webm)$'
  ) then
    raise exception 'proof file path is not valid';
  end if;

  select * into job from public.jobs where id = target_job;
  if job.id is null then
    raise exception 'job not found';
  end if;
  if uid is distinct from job.assigned_driver_id and not public.is_admin() then
    raise exception 'only the assigned driver can add proof';
  end if;

  select * into rules from public.proof_rules where service = job.service;
  select count(*) into stage_count
  from public.job_photos
  where job_id = target_job and stage = photo_stage::public.photo_stage;
  stage_max := case photo_stage
    when 'pickup' then rules.pickup_max
    when 'dropoff' then rules.dropoff_max
    else 3
  end;
  if stage_count >= stage_max then
    raise exception 'this step already has the maximum number of files';
  end if;

  perform set_config('pickuply.record_proof', 'yes', true);
  insert into public.job_photos (job_id, stage, storage_path, uploaded_by, captured_at, note, media_kind)
  values (
    target_job,
    photo_stage::public.photo_stage,
    storage_path,
    uid,
    now(),
    nullif(btrim(coalesce(photo_note, '')), ''),
    media_kind
  )
  returning id into photo_id;
  perform set_config('pickuply.record_proof', 'no', true);

  select proof_location_enabled into location_on from public.platform_settings where id = 1;
  if coalesce(share_location, false)
    and coalesce(location_on, false)
    and raw_lat is not null
    and raw_lng is not null
    and raw_lat between -90 and 90
    and raw_lng between -180 and 180 then
    insert into public.proof_locations (photo_id, approximate_lat, approximate_lng)
    values (photo_id, round(raw_lat, 2), round(raw_lng, 2));
  end if;

  return photo_id;
end;
$$;

revoke all on function public.record_proof(uuid, text, text, text, text, boolean, numeric, numeric)
  from public, anon, service_role;
grant execute on function public.record_proof(uuid, text, text, text, text, boolean, numeric, numeric)
  to authenticated;

create or replace function public.guard_proof_insert()
returns trigger
language plpgsql
as $$
begin
  if new.stage in ('pickup', 'dropoff', 'dump_receipt')
    and current_setting('pickuply.record_proof', true) is distinct from 'yes' then
    raise exception 'use the proof step';
  end if;
  return new;
end;
$$;

create trigger job_photos_guard_proof
  before insert on public.job_photos
  for each row execute function public.guard_proof_insert();

create or replace function public.file_job_report(
  target_job uuid,
  category text,
  description text,
  outcome_wanted text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job public.jobs%rowtype;
  report_id uuid;
  completed_at timestamptz;
  area text;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if category not in ('damaged', 'missing', 'late', 'no_show', 'extra_money', 'unsafe', 'other') then
    raise exception 'choose a problem type';
  end if;
  if outcome_wanted not in ('refund', 'repair', 'apology', 'note') then
    raise exception 'choose what you want to happen';
  end if;
  if char_length(btrim(coalesce(description, ''))) < 1 then
    raise exception 'describe the problem';
  end if;

  select * into job from public.jobs where id = target_job for update;
  if job.id is null then
    raise exception 'job not found';
  end if;
  if uid is distinct from job.customer_id
    and uid is distinct from job.assigned_driver_id
    and not public.is_admin() then
    raise exception 'you cannot report this job';
  end if;

  if job.status = 'completed' then
    select max(created_at) into completed_at
    from public.job_events
    where job_id = target_job and type = 'status' and data->>'to' = 'completed';
    if coalesce(completed_at, job.updated_at) < now() - interval '7 days' then
      raise exception 'the report window for this job has closed';
    end if;
  elsif job.status not in (
    'assigned', 'en_route', 'arrived', 'item_check', 'in_transit', 'delivered', 'disputed'
  ) then
    raise exception 'a report is not available for this job yet';
  end if;

  insert into public.job_reports (job_id, reporter_id, category, description, outcome_wanted)
  values (target_job, uid, category, btrim(description), outcome_wanted)
  returning id into report_id;

  insert into public.job_disputes (job_id, report_id, capture_hold, payout_hold)
  values (target_job, report_id, true, true)
  on conflict (job_id) do update
  set capture_hold = true,
      payout_hold = true,
      resolved_at = null;

  if job.status is distinct from 'disputed' then
    update public.jobs
    set status = 'disputed', updated_at = now()
    where id = target_job;
  end if;

  area := left(coalesce(job.pickup_area, 'the service area'), 80);
  perform public.enqueue_notification(
    job.customer_id, target_job, 'report', 'Problem reported',
    'A problem was reported on the job in ' || area || '.',
    '/jobs/' || target_job, 'report:' || report_id
  );
  if job.assigned_driver_id is not null then
    perform public.enqueue_notification(
      job.assigned_driver_id, target_job, 'report', 'Problem reported',
      'A problem was reported on the job in ' || area || '.',
      '/driver/jobs/' || target_job, 'report:' || report_id
    );
  end if;
  perform public.notify_admins(
    target_job,
    case when category in ('missing', 'unsafe') then 'report_critical' else 'report' end,
    case when category in ('missing', 'unsafe') then 'Immediate review' else 'Problem reported' end,
    'A problem was reported on a job in ' || area || '.',
    '/admin/requests/' || target_job,
    'report:' || report_id
  );

  return report_id;
end;
$$;

revoke all on function public.file_job_report(uuid, text, text, text) from public, anon, service_role;
grant execute on function public.file_job_report(uuid, text, text, text) to authenticated;

create or replace function public.resolve_dispute(
  target_job uuid,
  outcome text,
  notes text,
  amount_cents integer,
  reason text,
  release_capture boolean,
  release_payout boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.jobs%rowtype;
  area text;
begin
  if not public.is_admin() then
    raise exception 'only an admin can resolve a dispute';
  end if;
  if outcome not in ('no_action', 'partial_refund', 'full_refund', 'payout_adjustment', 'driver_warning', 'driver_pause') then
    raise exception 'choose an outcome';
  end if;
  if char_length(btrim(coalesce(notes, ''))) < 1 then
    raise exception 'add a note';
  end if;
  if outcome in ('partial_refund', 'full_refund', 'payout_adjustment')
    and (amount_cents is null or amount_cents < 0 or char_length(btrim(coalesce(reason, ''))) < 1) then
    raise exception 'enter an amount and a reason';
  end if;

  select * into job from public.jobs where id = target_job;
  if job.id is null or not exists (select 1 from public.job_disputes where job_id = target_job) then
    raise exception 'this job has no open problem report';
  end if;

  insert into public.dispute_resolutions (
    job_id, admin_id, outcome, notes, amount_cents, reason, release_capture, release_payout
  ) values (
    target_job, auth.uid(), outcome, btrim(notes), amount_cents, nullif(btrim(coalesce(reason, '')), ''),
    coalesce(release_capture, false), coalesce(release_payout, false)
  );

  update public.job_disputes
  set capture_hold = not coalesce(release_capture, false),
      payout_hold = not coalesce(release_payout, false),
      resolved_at = case
        when coalesce(release_capture, false) and coalesce(release_payout, false) then now()
        else null
      end
  where job_id = target_job;

  if outcome = 'driver_pause' and job.assigned_driver_id is not null then
    update public.drivers
    set status = 'paused', updated_at = now()
    where profile_id = job.assigned_driver_id;
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'resolve_dispute',
    'job',
    target_job,
    jsonb_build_object(
      'outcome', outcome,
      'amount_cents', amount_cents,
      'release_capture', coalesce(release_capture, false),
      'release_payout', coalesce(release_payout, false)
    )
  );

  area := left(coalesce(job.pickup_area, 'the service area'), 80);
  perform public.enqueue_notification(
    job.customer_id, target_job, 'report_resolved', 'Report reviewed',
    'Pickuply reviewed the problem report for the job in ' || area || '.',
    '/jobs/' || target_job, 'resolved:' || target_job || ':' || outcome
  );
  if job.assigned_driver_id is not null then
    perform public.enqueue_notification(
      job.assigned_driver_id, target_job, 'report_resolved', 'Report reviewed',
      'Pickuply reviewed the problem report for the job in ' || area || '.',
      '/driver/jobs/' || target_job, 'resolved:' || target_job || ':' || outcome
    );
  end if;
end;
$$;

revoke all on function public.resolve_dispute(uuid, text, text, integer, text, boolean, boolean)
  from public, anon, service_role;
grant execute on function public.resolve_dispute(uuid, text, text, integer, text, boolean, boolean)
  to authenticated;

create or replace function public.update_proof_rules(
  target_service text,
  pickup_min integer,
  pickup_max integer,
  dropoff_min integer,
  dropoff_max integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can change settings';
  end if;
  if target_service not in ('delivery', 'junk', 'free_item', 'construction') then
    raise exception 'choose a service';
  end if;
  update public.proof_rules
  set pickup_min = update_proof_rules.pickup_min,
      pickup_max = update_proof_rules.pickup_max,
      dropoff_min = update_proof_rules.dropoff_min,
      dropoff_max = update_proof_rules.dropoff_max
  where service = target_service::public.job_service;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'update_proof_rules',
    'proof_rules',
    null,
    jsonb_build_object('service', target_service)
  );
end;
$$;

revoke all on function public.update_proof_rules(text, integer, integer, integer, integer)
  from public, anon, service_role;
grant execute on function public.update_proof_rules(text, integer, integer, integer, integer)
  to authenticated;

create or replace function public.set_proof_location_enabled(enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can change settings';
  end if;
  update public.platform_settings
  set proof_location_enabled = coalesce(enabled, false), updated_at = now()
  where id = 1;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(), 'set_proof_location_enabled', 'platform_settings', null,
    jsonb_build_object('enabled', coalesce(enabled, false))
  );
end;
$$;

revoke all on function public.set_proof_location_enabled(boolean) from public, anon, service_role;
grant execute on function public.set_proof_location_enabled(boolean) to authenticated;

create or replace function public.set_disposal_receipt(target_job uuid, required boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can change settings';
  end if;
  update public.jobs
  set require_disposal_receipt = coalesce(required, false), updated_at = now()
  where id = target_job and service = 'junk';
  if not found then
    raise exception 'a disposal receipt can be required on a junk job';
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(), 'set_disposal_receipt', 'job', target_job,
    jsonb_build_object('required', coalesce(required, false))
  );
end;
$$;

revoke all on function public.set_disposal_receipt(uuid, boolean) from public, anon, service_role;
grant execute on function public.set_disposal_receipt(uuid, boolean) to authenticated;

-- Storage: admin can read and add job photos, and cannot delete or replace them.
drop policy if exists job_photos_storage_admin_all on storage.objects;
create policy job_photos_storage_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'job-photos' and public.is_admin());
create policy job_photos_storage_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'job-photos' and public.is_admin());
