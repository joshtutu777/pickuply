-- Job steps: the assigned driver, the customer, or an admin with a reason.
-- Rejecting an item records the trip fee. Capturing that fee waits for the payment step.
-- Do not apply this file to the hosted project until the owner approves it.

alter table public.platform_settings
  add column trip_fee_cents integer not null default 2500 check (trip_fee_cents >= 0);

alter table public.jobs
  add column trip_fee_cents integer,
  add column customer_confirmed_at timestamptz,
  add column rejection_reason text,
  add constraint jobs_trip_fee_nonnegative check (trip_fee_cents is null or trip_fee_cents >= 0),
  add constraint jobs_rejection_reason check (
    rejection_reason is null or char_length(btrim(rejection_reason)) between 3 and 500
  );

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

  if not (
    (job_row.status = 'assigned' and next_status = 'en_route')
    or (job_row.status = 'en_route' and next_status = 'arrived')
    or (job_row.status = 'arrived' and next_status = 'item_check')
    or (job_row.status = 'in_transit' and next_status = 'delivered')
  ) then
    raise exception 'that step is not available';
  end if;

  if next_status = 'delivered' then
    select * into rules from public.proof_rules where service = job_row.service;
    select count(*) into dropoff_count
    from public.job_photos
    where job_id = target_job and stage = 'dropoff' and report_id is null;
    if rules.dropoff_min is null or dropoff_count < rules.dropoff_min then
      raise exception 'add the delivery photo first';
    end if;
    if job_row.service = 'junk' and job_row.require_disposal_receipt and not exists (
      select 1 from public.job_photos
      where job_id = target_job and stage = 'dump_receipt' and report_id is null
    ) then
      raise exception 'add the disposal receipt first';
    end if;
  end if;

  update public.jobs
  set status = next_status::public.job_status
  where id = target_job;
end;
$$;

create or replace function public.approve_pickup(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  rules public.proof_rules%rowtype;
  pickup_count integer;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from uid then
    raise exception 'only the customer can approve the item';
  end if;
  if job_row.status is distinct from 'item_check' then
    raise exception 'the item is not ready for approval';
  end if;
  if exists (select 1 from public.job_disputes where job_id = target_job and resolved_at is null) then
    raise exception 'this job is on hold';
  end if;
  select * into rules from public.proof_rules where service = job_row.service;
  select count(*) into pickup_count
  from public.job_photos
  where job_id = target_job and stage = 'pickup' and report_id is null;
  if rules.pickup_min is null or pickup_count < rules.pickup_min then
    raise exception 'the pickup photo is not ready';
  end if;

  update public.jobs set status = 'in_transit' where id = target_job;
  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, uid, 'pickup_approved', jsonb_build_object('to', 'in_transit'));
  perform public.enqueue_notification(
    job_row.assigned_driver_id, target_job, 'pickup_approved',
    'Item approved',
    'The customer approved the item. You can continue.',
    '/driver/jobs/' || target_job::text,
    'pickup-approved:' || target_job::text
  );
end;
$$;

create or replace function public.reject_pickup(target_job uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  fee integer;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if length(btrim(coalesce(reason, ''))) < 3 then
    raise exception 'add a short reason';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from uid then
    raise exception 'only the customer can reject the item';
  end if;
  if job_row.status is distinct from 'item_check' then
    raise exception 'the item is not ready for a decision';
  end if;
  select trip_fee_cents into fee from public.platform_settings where id = 1;

  update public.jobs
  set status = 'cancelled',
      trip_fee_cents = fee,
      rejection_reason = left(btrim(reason), 500)
  where id = target_job;
  insert into public.job_events (job_id, actor_id, type, data)
  values (
    target_job, uid, 'pickup_rejected',
    jsonb_build_object('to', 'cancelled', 'trip_fee_cents', fee)
  );
  perform public.enqueue_notification(
    job_row.assigned_driver_id, target_job, 'pickup_rejected',
    'Item rejected',
    'The customer rejected the item at pickup. The trip fee is recorded.',
    '/driver/jobs/' || target_job::text,
    'pickup-rejected:' || target_job::text
  );
  perform public.notify_admins(
    target_job, 'pickup_rejected',
    'Item rejected at pickup',
    'The trip fee is recorded and still needs to be captured.',
    '/admin/requests/' || target_job::text,
    'pickup-rejected-admin:' || target_job::text
  );
end;
$$;

create or replace function public.confirm_delivery(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from uid then
    raise exception 'only the customer can confirm delivery';
  end if;
  if job_row.status is distinct from 'delivered' then
    raise exception 'this job is not delivered yet';
  end if;
  if exists (select 1 from public.job_disputes where job_id = target_job and capture_hold) then
    raise exception 'payment is on hold';
  end if;
  if job_row.customer_confirmed_at is not null then
    return;
  end if;

  update public.jobs set customer_confirmed_at = now() where id = target_job;
  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, uid, 'delivery_confirmed', jsonb_build_object('to', 'delivered'));
  perform public.enqueue_notification(
    job_row.assigned_driver_id, target_job, 'delivery_confirmed',
    'Customer confirmed',
    'The customer confirmed this job.',
    '/driver/jobs/' || target_job::text,
    'delivery-confirmed:' || target_job::text
  );
end;
$$;

create or replace function public.admin_override_status(
  target_job uuid,
  next_status text,
  reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can override a job';
  end if;
  if length(btrim(coalesce(reason, ''))) < 3 then
    raise exception 'add a short reason';
  end if;
  if next_status not in (
    'open', 'assigned', 'en_route', 'arrived', 'item_check', 'in_transit', 'delivered', 'cancelled', 'disputed'
  ) then
    raise exception 'that status is not available';
  end if;

  select * into job_row from public.jobs where id = target_job for update;
  if not found then
    raise exception 'job not found';
  end if;
  if next_status = 'completed' then
    raise exception 'completion follows a captured payment';
  end if;

  if next_status = 'open' then
    perform set_config('pickuply.system_release', 'yes', true);
    update public.jobs
    set status = 'open', assigned_driver_id = null, accepted_offer_id = null
    where id = target_job;
  else
    update public.jobs
    set status = next_status::public.job_status
    where id = target_job;
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(), 'admin_override_status', 'job', target_job,
    jsonb_build_object('from', job_row.status, 'to', next_status, 'reason', left(btrim(reason), 500))
  );
  insert into public.job_events (job_id, actor_id, type, data)
  values (
    target_job, auth.uid(), 'admin_override',
    jsonb_build_object('from', job_row.status, 'to', next_status, 'reason', left(btrim(reason), 500))
  );
end;
$$;

revoke all on function public.approve_pickup(uuid) from public, anon, service_role;
grant execute on function public.approve_pickup(uuid) to authenticated;

revoke all on function public.reject_pickup(uuid, text) from public, anon, service_role;
grant execute on function public.reject_pickup(uuid, text) to authenticated;

revoke all on function public.confirm_delivery(uuid) from public, anon, service_role;
grant execute on function public.confirm_delivery(uuid) to authenticated;

revoke all on function public.admin_override_status(uuid, text, text) from public, anon, service_role;
grant execute on function public.admin_override_status(uuid, text, text) to authenticated;
