-- Backfill pickup-review deadlines for jobs already in item_check.
-- An expired review closes when the assigned driver takes the next step.
-- A junk disposal receipt is required only when the job has a dump fee or the receipt flag.
-- Local only until the owner approves a hosted apply.

create table public.pickup_review_backfill (
  job_id uuid primary key references public.jobs (id) on delete cascade,
  action text not null,
  reason text not null,
  deadline timestamptz,
  applied_at timestamptz not null default now(),
  constraint pickup_review_backfill_action check (action in ('deadline_set', 'ambiguous', 'excluded'))
);

alter table public.pickup_review_backfill enable row level security;

create policy pickup_review_backfill_admin_read on public.pickup_review_backfill
  for select to authenticated
  using (public.is_admin());

grant select on public.pickup_review_backfill to authenticated;

create or replace function public.apply_pickup_review_backfill()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  scheduled integer := 0;
begin
  insert into public.pickup_review_backfill (job_id, action, reason, deadline)
  select
    jobs.id,
    case
      when jobs.pickup_review_result is not null or jobs.pickup_review_closed_at is not null then 'excluded'
      when jobs.pickup_review_until is not null then 'excluded'
      when jobs.rejection_reason is not null then 'excluded'
      when jobs.test_retired_at is not null then 'excluded'
      when exists (
        select 1 from public.job_disputes disputes
        where disputes.job_id = jobs.id and disputes.resolved_at is null
      ) then 'excluded'
      when coalesce(events.check_events, 0) = 0 then 'ambiguous'
      when events.check_events > 1 then 'ambiguous'
      when photos.photo_at is null then 'ambiguous'
      when abs(extract(epoch from (events.check_at - photos.photo_at))) > 900 then 'ambiguous'
      else 'deadline_set'
    end,
    case
      when jobs.pickup_review_result is not null or jobs.pickup_review_closed_at is not null then 'already_decided'
      when jobs.pickup_review_until is not null then 'already_scheduled'
      when jobs.rejection_reason is not null then 'rejected'
      when jobs.test_retired_at is not null then 'retired'
      when exists (
        select 1 from public.job_disputes disputes
        where disputes.job_id = jobs.id and disputes.resolved_at is null
      ) then 'open_dispute'
      when coalesce(events.check_events, 0) = 0 then 'missing_pickup_event'
      when events.check_events > 1 then 'repeated_pickup_event'
      when photos.photo_at is null then 'missing_pickup_photo'
      when abs(extract(epoch from (events.check_at - photos.photo_at))) > 900 then 'pickup_time_disagrees'
      else 'pickup_event'
    end,
    case
      when jobs.pickup_review_result is null
        and jobs.pickup_review_closed_at is null
        and jobs.pickup_review_until is null
        and jobs.rejection_reason is null
        and jobs.test_retired_at is null
        and not exists (
          select 1 from public.job_disputes disputes
          where disputes.job_id = jobs.id and disputes.resolved_at is null
        )
        and events.check_events = 1
        and photos.photo_at is not null
        and abs(extract(epoch from (events.check_at - photos.photo_at))) <= 900
      then events.check_at + interval '10 minutes'
      else null
    end
  from public.jobs
  left join lateral (
    select count(*)::integer as check_events, min(created_at) as check_at
    from public.job_events
    where job_events.job_id = jobs.id
      and job_events.type = 'status'
      and job_events.data->>'to' = 'item_check'
  ) events on true
  left join lateral (
    select min(captured_at) as photo_at
    from public.job_photos
    where job_photos.job_id = jobs.id
      and job_photos.stage = 'pickup'
      and job_photos.report_id is null
  ) photos on true
  where jobs.status = 'item_check'
  on conflict (job_id) do nothing;

  update public.jobs
  set pickup_review_until = backfill.deadline
  from public.pickup_review_backfill backfill
  where jobs.id = backfill.job_id
    and backfill.action = 'deadline_set'
    and backfill.deadline is not null
    and jobs.status = 'item_check'
    and jobs.pickup_review_until is null
    and jobs.pickup_review_result is null
    and jobs.pickup_review_closed_at is null
    and jobs.rejection_reason is null
    and jobs.test_retired_at is null
    and not exists (
      select 1 from public.job_disputes disputes
      where disputes.job_id = jobs.id and disputes.resolved_at is null
    );
  get diagnostics scheduled = row_count;
  return scheduled;
end;
$$;

revoke all on function public.apply_pickup_review_backfill() from public, anon, authenticated;
grant execute on function public.apply_pickup_review_backfill() to service_role;

select public.apply_pickup_review_backfill();

create or replace function public.advance_job(target_job uuid, next_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  rules public.proof_rules%rowtype;
  dropoff_count integer;
  pickup_count integer;
  driver_name text := 'Your driver';
begin
  if uid is null then
    raise exception 'sign in required';
  end if;

  select * into job_row
  from public.jobs
  where id = target_job and assigned_driver_id = uid
  for update;

  if not found then
    raise exception 'only the assigned driver can update this job';
  end if;

  if job_row.test_retired_at is not null or job_row.status in ('cancelled', 'disputed', 'completed') then
    raise exception 'that step is not available';
  end if;

  if public.account_is_suspended(uid) and job_row.status is distinct from 'in_transit' then
    raise exception 'This booking requires assistance from Pickuply support.';
  end if;

  if next_status = 'at_dropoff' and job_row.status = 'item_check' then
    perform public.close_pickup_review(target_job);
    select * into job_row
    from public.jobs
    where id = target_job and assigned_driver_id = uid
    for update;
  end if;

  if next_status = 'at_dropoff' then
    if job_row.status is distinct from 'in_transit' then
      raise exception 'that step is not available';
    end if;
    if job_row.dropoff_arrived_at is not null then
      return;
    end if;
    update public.jobs set dropoff_arrived_at = now() where id = target_job;
    insert into public.job_events (job_id, actor_id, type, data)
    values (target_job, uid, 'dropoff_arrived', jsonb_build_object('to', 'at_dropoff'));
    select coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'Your driver')
    into driver_name
    from public.profiles
    where id = uid;
    perform public.enqueue_notification(
      job_row.customer_id, target_job, 'dropoff_arrived', 'Driver arrived',
      driver_name || ' has arrived. Please meet them.',
      '/jobs/' || target_job::text,
      'dropoff-arrived:' || target_job::text
    );
    return;
  end if;

  if not (
    (job_row.status = 'assigned' and next_status = 'en_route')
    or (job_row.status = 'en_route' and next_status = 'arrived')
    or (job_row.status = 'arrived' and next_status = 'item_check')
    or (job_row.status = 'in_transit' and next_status = 'delivered')
  ) then
    raise exception 'that step is not available';
  end if;

  if next_status = 'item_check' then
    select * into rules from public.proof_rules where service = job_row.service;
    select count(*) into pickup_count
    from public.job_photos
    where job_id = target_job and stage = 'pickup' and report_id is null;
    if rules.pickup_min is null or pickup_count < rules.pickup_min then
      raise exception 'add the pickup photo first';
    end if;
  end if;

  if next_status = 'delivered' then
    select * into rules from public.proof_rules where service = job_row.service;
    select count(*) into dropoff_count
    from public.job_photos
    where job_id = target_job and stage = 'dropoff' and report_id is null;
    if rules.dropoff_min is null or dropoff_count < rules.dropoff_min then
      raise exception 'add the delivery photo first';
    end if;
    if coalesce(public.disposal_receipt_required(target_job), false) and not exists (
      select 1 from public.job_photos
      where job_id = target_job and stage = 'dump_receipt' and report_id is null
    ) then
      raise exception 'add the disposal receipt first';
    end if;
    if job_row.dropoff_arrived_at is null then
      raise exception 'that step is not available';
    end if;
  end if;

  update public.jobs
  set status = next_status::public.job_status,
      pickup_review_until = case
        when next_status = 'item_check' then now() + interval '10 minutes'
        else pickup_review_until
      end
  where id = target_job;
end;
$$;
