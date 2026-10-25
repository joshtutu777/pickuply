-- Approved account rules: active deliveries, 14-day deletion grace, stop driving,
-- three-year phone restrictions, and the last admin. Local until applied.
-- Does not change payment capture, refunds, or the 48-hour new-driver hold.

alter table public.jobs
  add column needs_reassignment boolean not null default false;

alter table public.drivers
  add column driving_stopped_at timestamptz;

alter table public.account_deletion_requests
  add column grace_ends_at timestamptz,
  add column cancelled_at timestamptz;

alter table public.account_deletion_requests
  drop constraint account_deletion_status;

alter table public.account_deletion_requests
  add constraint account_deletion_status
  check (status in ('pending', 'completed', 'deferred', 'cancelled'));

create or replace function public.phone_hmac_secret()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  configured text := current_setting('pickuply.phone_hmac_secret', true);
  secret text;
begin
  -- A setting that exists, including an empty one, wins over Vault.
  -- Empty means the secret is missing and restriction checks stay closed.
  if configured is not null then
    return nullif(configured, '');
  end if;
  if to_regclass('vault.decrypted_secrets') is not null then
    select decrypted_secret into secret
    from vault.decrypted_secrets
    where name = 'phone_hmac_secret'
    limit 1;
  end if;
  return nullif(secret, '');
end;
$$;

revoke all on function public.phone_hmac_secret() from public, anon, authenticated, service_role;

create or replace function public.phone_hmac(raw text)
returns text
language plpgsql
stable
as $$
declare
  secret text := public.phone_hmac_secret();
  phone text := public.normalize_phone(raw);
begin
  if secret is null or phone is null then
    return null;
  end if;
  return encode(extensions.hmac(phone, secret, 'sha256'), 'hex');
end;
$$;

create or replace function public.phone_is_restricted(raw text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_digest text := public.phone_hmac(raw);
  previous_secret text := nullif(current_setting('pickuply.phone_hmac_secret_previous', true), '');
  previous_digest text;
  phone text := public.normalize_phone(raw);
begin
  if current_digest is not null and exists (
    select 1 from public.phone_restrictions
    where phone_hmac = current_digest
      and (expires_at is null or expires_at > now())
  ) then
    return true;
  end if;
  if previous_secret is null or phone is null then
    return false;
  end if;
  previous_digest := encode(extensions.hmac(phone, previous_secret, 'sha256'), 'hex');
  return exists (
    select 1 from public.phone_restrictions
    where phone_hmac = previous_digest
      and (expires_at is null or expires_at > now())
  );
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.phone is not null and new.phone_confirmed_at is null and new.email is null then
    return new;
  end if;
  if public.phone_hmac_secret() is null then
    raise exception 'registration is unavailable until phone protection is configured';
  end if;
  insert into public.profiles (id, role, phone, email)
  values (new.id, 'customer', new.phone, new.email);
  return new;
end;
$$;

create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.role = 'admin'
    and old.deleted_at is null
    and (new.role is distinct from 'admin' or new.deleted_at is not null) then
    perform id
    from public.profiles
    where role = 'admin' and deleted_at is null
    order by id
    for update;
    if public.other_active_admins(old.id) = 0 then
      raise exception 'the last active admin cannot be removed';
    end if;
  end if;

  if tg_op = 'INSERT' and new.role <> 'customer' and not public.is_migration_session() and not public.is_admin() then
    raise exception 'new profiles start as customers';
  end if;

  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    if auth.uid() is not null and auth.uid() = old.id and not public.is_admin() then
      raise exception 'users cannot change their own role';
    end if;
    if not public.is_admin() and not public.is_migration_session() then
      raise exception 'only an admin can change a role';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.flag_unstarted_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' then
    update public.jobs
    set needs_reassignment = true
    where assigned_driver_id = new.profile_id
      and status = 'assigned';
    perform public.notify_admins(
      jobs.id,
      'needs_reassignment',
      'Assigned job has not started',
      'This booking was flagged for a new driver. It was not cancelled.',
      '/admin/requests/' || jobs.id::text,
      'needs-reassignment:' || jobs.id::text || ':' || new.profile_id::text
    )
    from public.jobs
    where assigned_driver_id = new.profile_id
      and status = 'assigned'
      and needs_reassignment;
  end if;
  return new;
end;
$$;

drop trigger if exists account_suspensions_flag_jobs on public.account_suspensions;
create trigger account_suspensions_flag_jobs
  after insert or update of status on public.account_suspensions
  for each row execute function public.flag_unstarted_jobs();

create or replace function public.block_reassignment_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.needs_reassignment
    and coalesce(current_setting('pickuply.admin_reassign', true), '') is distinct from 'yes'
    and (
      new.assigned_driver_id is distinct from old.assigned_driver_id
      or new.status is distinct from old.status
      or new.payment_status is distinct from old.payment_status
      or new.price_cents is distinct from old.price_cents
      or new.driver_pay_cents is distinct from old.driver_pay_cents
    ) then
    raise exception 'This booking requires assistance from Pickuply support.';
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_block_reassignment on public.jobs;
create trigger jobs_block_reassignment
  before update on public.jobs
  for each row execute function public.block_reassignment_changes();

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

  if public.account_is_suspended(uid) and job_row.status is distinct from 'in_transit' then
    raise exception 'This booking requires assistance from Pickuply support.';
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

create or replace function public.reassign_flagged_job(target_job uuid, next_driver uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can reassign this job';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or not job_row.needs_reassignment or job_row.status is distinct from 'assigned' then
    raise exception 'this job is not waiting for a new driver';
  end if;
  if next_driver is null or public.account_is_suspended(next_driver) then
    raise exception 'choose an available driver';
  end if;
  if not exists (
    select 1 from public.drivers
    where profile_id = next_driver and status in ('active', 'approved_new') and driving_stopped_at is null
  ) then
    raise exception 'choose an available driver';
  end if;
  perform set_config('pickuply.admin_reassign', 'yes', true);
  perform set_config('pickuply.admin_assign', 'yes', true);
  update public.jobs
  set assigned_driver_id = next_driver, needs_reassignment = false
  where id = target_job;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(), 'reassign_flagged_job', 'job', target_job,
    jsonb_build_object('previous_driver', job_row.assigned_driver_id, 'next_driver', next_driver)
  );
end;
$$;

revoke all on function public.reassign_flagged_job(uuid, uuid) from public, anon, service_role;
grant execute on function public.reassign_flagged_job(uuid, uuid) to authenticated;

create or replace function public.deletion_blockers(target uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_remove(array[
    case when exists (
      select 1 from public.jobs
      where (customer_id = target or assigned_driver_id = target)
        and status in ('assigned', 'en_route', 'arrived', 'item_check', 'in_transit', 'delivered')
    ) then 'active_job' end,
    case when exists (
      select 1 from public.job_disputes disputes
      join public.jobs on jobs.id = disputes.job_id
      where disputes.resolved_at is null
        and disputes.capture_hold
        and (jobs.customer_id = target or jobs.assigned_driver_id = target)
    ) then 'payment_hold' end,
    case when exists (
      select 1 from public.jobs
      where (customer_id = target or assigned_driver_id = target)
        and payment_status = 'authorized'
    ) then 'pending_capture' end,
    case when exists (
      select 1 from public.jobs
      where (customer_id = target or assigned_driver_id = target)
        and payment_status = 'awaiting_payment'
    ) then 'open_payment' end,
    case when exists (
      select 1 from public.refund_requests refunds
      join public.jobs on jobs.id = refunds.job_id
      where refunds.status = 'pending'
        and (jobs.customer_id = target or jobs.assigned_driver_id = target)
    ) then 'pending_refund' end,
    case when exists (
      select 1 from public.ledger_entries
      where driver_id = target and status in ('pending', 'ready')
    ) then 'pending_payout' end,
    case when exists (
      select 1 from public.ledger_entries
      where driver_id = target and status in ('held', 'held_until_onboarding')
    ) then 'held_payout' end,
    case when exists (
      select 1 from public.job_disputes disputes
      join public.jobs on jobs.id = disputes.job_id
      where disputes.resolved_at is null
        and (jobs.customer_id = target or jobs.assigned_driver_id = target)
    ) then 'open_dispute' end,
    case when exists (
      select 1 from public.ledger_entries
      where driver_id = target and status = 'recovery_due'
    ) or exists (
      select 1 from public.recovery_obligations
      where driver_id = target and status = 'recovery_due'
    ) then 'recovery_due' end
  ], null), '{}');
$$;

create or replace function public.finish_account_deletion(target uuid, actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  phone text;
  digest text;
  restriction_until timestamptz;
  suspension public.account_suspensions%rowtype;
  removed boolean;
begin
  if exists (select 1 from public.profiles where id = target and deleted_at is not null) then
    return;
  end if;
  if cardinality(public.deletion_blockers(target)) > 0 then
    raise exception 'this account still has obligations';
  end if;
  select profiles.phone into phone from public.profiles where id = target;
  select * into suspension
  from public.account_suspensions
  where profile_id = target and status = 'active'
    and (expires_at is null or expires_at > now());
  select exists (
    select 1 from public.drivers where profile_id = target and status = 'removed'
  ) into removed;
  if suspension.id is not null or removed then
    if public.phone_hmac_secret() is null then
      raise exception 'phone restriction cannot be recorded';
    end if;
    digest := public.phone_hmac(phone);
    restriction_until := coalesce(suspension.expires_at, now() + interval '3 years');
    if digest is not null and restriction_until > now() then
      insert into public.phone_restrictions (phone_hmac, expires_at, source_profile_id)
      values (digest, restriction_until, target)
      on conflict (phone_hmac) do update
        set expires_at = excluded.expires_at, source_profile_id = excluded.source_profile_id;
    end if;
  end if;
  update public.profiles
  set full_name = 'Deleted account',
      phone = null,
      email = null,
      photo_url = null,
      deleted_at = now()
  where id = target;
  delete from public.push_subscriptions where profile_id = target;
  if to_regclass('auth.sessions') is not null then
    delete from auth.sessions where user_id = target;
  end if;
  if to_regclass('auth.refresh_tokens') is not null then
    delete from auth.refresh_tokens where user_id = target::text;
  end if;
  update public.account_deletion_requests
  set status = 'completed', completed_at = now(), completed_by = actor, blockers = '{}', updated_at = now()
  where profile_id = target and status in ('pending', 'deferred');
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (actor, 'complete_account_deletion', 'profile', target, jsonb_build_object('next', 'deleted'));
end;
$$;

create or replace function public.request_account_deletion()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  role_name text;
  signed_in timestamptz;
  blockers text[];
  grace timestamptz := now() + interval '14 days';
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if (select deleted_at from public.profiles where id = uid) is not null then
    raise exception 'this account is already deleted';
  end if;
  select role into role_name from public.profiles where id = uid;
  select last_sign_in_at into signed_in from auth.users where id = uid;
  if signed_in is null or signed_in < now() - interval '30 minutes' then
    raise exception 'confirm your phone again';
  end if;
  if exists (
    select 1 from public.account_deletion_requests
    where profile_id = uid and status in ('pending', 'deferred')
  ) then
    return 'pending';
  end if;
  blockers := public.deletion_blockers(uid);
  insert into public.account_deletion_requests (profile_id, status, blockers, grace_ends_at)
  values (uid, 'pending', blockers, grace);
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (uid, 'request_account_deletion', 'profile', uid, jsonb_build_object('status', 'pending', 'grace_ends_at', grace));
  perform public.enqueue_notification(
    uid, null, 'deletion_requested',
    'Deletion request received',
    'Your deletion request is pending for 14 days. You can cancel it until then. Open jobs or unpaid money can keep it pending after that.',
    '/account/delete',
    'deletion-requested:' || uid::text
  );
  return 'pending';
end;
$$;

create or replace function public.cancel_account_deletion()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  signed_in timestamptz;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select last_sign_in_at into signed_in from auth.users where id = uid;
  if signed_in is null or signed_in < now() - interval '30 minutes' then
    raise exception 'confirm your phone again';
  end if;
  update public.account_deletion_requests
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where profile_id = uid
    and status = 'pending'
    and grace_ends_at > now();
  if not found then
    raise exception 'this deletion request cannot be cancelled';
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (uid, 'cancel_account_deletion', 'profile', uid, jsonb_build_object('status', 'cancelled'));
  perform public.enqueue_notification(
    uid, null, 'deletion_cancelled',
    'Deletion request cancelled',
    'Your account stays open. The deletion request was cancelled.',
    '/account',
    'deletion-cancelled:' || uid::text || ':' || floor(extract(epoch from now()))::text
  );
end;
$$;

create or replace function public.process_due_deletions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.account_deletion_requests%rowtype;
  blockers text[];
  role_name text;
begin
  for row in
    select requests.*
    from public.account_deletion_requests requests
    join public.profiles on profiles.id = requests.profile_id
    where requests.status = 'pending'
      and requests.grace_ends_at is not null
      and requests.grace_ends_at <= now()
      and profiles.deleted_at is null
    order by requests.profile_id
    for update of requests skip locked
  loop
    select role into role_name from public.profiles where id = row.profile_id;
    blockers := public.deletion_blockers(row.profile_id);
    if role_name = 'admin' or cardinality(blockers) > 0 then
      execute
        'update public.account_deletion_requests set blockers = $1, updated_at = now() where id = $2 and status = ''pending'''
        using blockers, row.id;
      continue;
    end if;
    begin
      perform public.finish_account_deletion(row.profile_id, null);
    exception
      when others then
        if sqlerrm = 'phone restriction cannot be recorded' then
          update public.account_deletion_requests
          set blockers = array['phone_restriction_unavailable'], updated_at = now()
          where id = row.id and status = 'pending';
        else
          raise;
        end if;
    end;
  end loop;
end;
$$;

create or replace function public.complete_account_deletion(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  blockers text[];
  role_name text;
  grace timestamptz;
begin
  if not public.is_admin() then
    raise exception 'only an admin can complete account deletion';
  end if;
  if target = auth.uid() then
    raise exception 'an admin cannot delete their own account this way';
  end if;
  select role into role_name from public.profiles where id = target and deleted_at is null;
  if role_name is null then
    raise exception 'account not found';
  end if;
  if role_name = 'admin' and public.other_active_admins(target) = 0 then
    raise exception 'the last active admin cannot be deleted';
  end if;
  select grace_ends_at into grace
  from public.account_deletion_requests
  where profile_id = target and status in ('pending', 'deferred')
  order by requested_at desc
  limit 1;
  if grace is null or grace > now() then
    raise exception 'the 14-day grace period has not ended';
  end if;
  blockers := public.deletion_blockers(target);
  if cardinality(blockers) > 0 then
    raise exception 'this account still has obligations';
  end if;
  perform public.finish_account_deletion(target, auth.uid());
end;
$$;

revoke all on function public.cancel_account_deletion() from public, anon, service_role;
revoke all on function public.process_due_deletions() from public, anon, authenticated;
grant execute on function public.cancel_account_deletion() to authenticated;
grant execute on function public.process_due_deletions() to service_role;

create or replace function public.stop_driving()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  signed_in timestamptz;
  blockers text[];
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if not exists (select 1 from public.drivers where profile_id = uid) then
    raise exception 'this account is not a driver';
  end if;
  select last_sign_in_at into signed_in from auth.users where id = uid;
  if signed_in is null or signed_in < now() - interval '30 minutes' then
    raise exception 'confirm your phone again';
  end if;
  if exists (select 1 from public.drivers where profile_id = uid and driving_stopped_at is not null) then
    return 'stopped';
  end if;
  perform set_config('pickuply.driver_online', 'yes', true);
  update public.job_offers
  set status = 'expired', unavailable_at = now()
  where driver_id = uid and status = 'active';
  update public.drivers
  set driving_stopped_at = now(), is_online = false
  where profile_id = uid;
  blockers := public.deletion_blockers(uid);
  if cardinality(blockers) > 0 then
    insert into public.audit_log (actor_id, action, target_type, target_id, data)
    values (uid, 'stop_driving', 'profile', uid, jsonb_build_object('status', 'pending', 'blockers', blockers));
    return 'pending';
  end if;
  update public.drivers
  set license_url = null,
      insurance_url = null,
      helper_name = null,
      helper_phone = null,
      agreement_signature = null
  where profile_id = uid;
  update public.vehicles
  set plate = null, photo_url = null
  where driver_id = uid;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (uid, 'stop_driving', 'profile', uid, jsonb_build_object('status', 'stopped'));
  perform public.enqueue_notification(
    uid, null, 'stopped_driving',
    'You stopped driving',
    'Your customer account stays open. New driver offers are closed.',
    '/account',
    'stopped-driving:' || uid::text
  );
  return 'stopped';
end;
$$;

revoke all on function public.stop_driving() from public, anon, service_role;
grant execute on function public.stop_driving() to authenticated;

create or replace function public.cleanup_account_retention()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  photo record;
begin
  delete from public.phone_restrictions
  where expires_at is not null and expires_at <= now();

  for photo in
    select job_photos.id, job_photos.storage_path
    from public.job_photos
    join public.jobs on jobs.id = job_photos.job_id
    join public.profiles on profiles.id in (jobs.customer_id, jobs.assigned_driver_id)
    where profiles.deleted_at is not null
      and profiles.deleted_at <= now() - interval '90 days'
      and not exists (
        select 1 from public.job_disputes disputes
        where disputes.job_id = jobs.id
      )
  loop
    delete from public.job_photos where id = photo.id;
    delete from storage.objects
    where bucket_id = 'job-photos' and name = photo.storage_path;
  end loop;

  update public.drivers
  set license_url = null, insurance_url = null, helper_phone = null, agreement_signature = null
  where profile_id in (
    select id from public.profiles
    where deleted_at is not null and deleted_at <= now() - interval '90 days'
  )
  and not exists (
    select 1
    from public.jobs
    join public.job_disputes disputes on disputes.job_id = jobs.id
    where jobs.assigned_driver_id = drivers.profile_id
  );
end;
$$;

revoke all on function public.cleanup_account_retention() from public, anon, authenticated;
grant execute on function public.cleanup_account_retention() to service_role;

create or replace function public.driver_is_eligible_for_job(target_job uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  profile_row public.profiles%rowtype;
  driver_row public.drivers%rowtype;
  job_row public.jobs%rowtype;
begin
  if uid is null or public.account_is_suspended(uid) then
    return false;
  end if;
  select * into profile_row from public.profiles where id = uid;
  if not found or profile_row.blocked or profile_row.deleted_at is not null then
    return false;
  end if;
  if public.phone_is_restricted(profile_row.phone) then
    return false;
  end if;
  select * into driver_row from public.drivers where profile_id = uid;
  if not found or driver_row.status not in ('active', 'approved_new') or driver_row.driving_stopped_at is not null then
    return false;
  end if;
  select * into job_row from public.jobs where id = target_job;
  if not found or job_row.status <> 'open' then
    return false;
  end if;
  if job_row.customer_id = uid or public.account_is_suspended(job_row.customer_id) then
    return false;
  end if;
  if job_row.paused_at is not null and not (
    job_row.suspension_hold and not public.account_is_suspended(job_row.customer_id)
  ) then
    return false;
  end if;
  if job_row.required_vehicle is not null and not exists (
    select 1 from public.vehicles
    where driver_id = uid and type = job_row.required_vehicle
  ) then
    return false;
  end if;
  if exists (
    select 1 from public.customer_driver_blocks
    where customer_id = job_row.customer_id and driver_id = uid
  ) then
    return false;
  end if;
  if public.waves_enabled() and not public.job_released_to_driver(uid, job_row) then
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.assert_driver_can_take_job(target_job uuid, action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  driver_row public.drivers%rowtype;
  job_row public.jobs%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if public.account_is_suspended(uid) then
    raise exception 'Your Pickuply driver account is restricted. You cannot submit offers or accept new jobs while this restriction is active.';
  end if;
  if exists (select 1 from public.drivers where profile_id = uid and driving_stopped_at is not null) then
    raise exception 'You stopped driving. You cannot submit offers or accept new jobs.';
  end if;
  if public.phone_is_restricted((select phone from public.profiles where id = uid)) then
    raise exception 'This phone number cannot be used for Pickuply right now. Contact support if you think this is a mistake.';
  end if;
  select * into driver_row from public.drivers where profile_id = uid;
  if not found or driver_row.status not in ('active', 'approved_new') then
    raise exception 'Finish setup to accept jobs.';
  end if;
  if not driver_row.is_online then
    if action = 'offer' then
      raise exception 'go online before sending an offer';
    end if;
    raise exception 'go online before claiming a job';
  end if;
  select * into job_row from public.jobs where id = target_job;
  if found and (public.account_is_suspended(job_row.customer_id) or job_row.suspension_hold) then
    raise exception 'This request is no longer available.';
  end if;
  if found and job_row.required_vehicle is not null and not exists (
    select 1 from public.vehicles
    where driver_id = uid and type = job_row.required_vehicle
  ) then
    raise exception 'This job needs a different vehicle.';
  end if;
  if not public.driver_is_eligible_for_job(target_job) then
    if action = 'offer' then
      raise exception 'this driver cannot offer on this job';
    end if;
    raise exception 'this driver cannot claim this job';
  end if;
end;
$$;

create or replace function public.driver_browse_jobs()
returns table (
  id uuid,
  service public.job_service,
  pieces integer,
  size public.item_size,
  pickup_area text,
  dropoff_area text,
  distance_miles numeric,
  stairs_pickup integer,
  stairs_dropoff integer,
  elevator boolean,
  help_loading boolean,
  preferred_date text,
  time_window public.time_window,
  pricing_method public.pricing_method,
  offer_cents integer,
  budget_min_cents integer,
  budget_max_cents integer,
  driver_pay_cents integer,
  quote_expires_at timestamptz,
  junk_load_size public.junk_load_size,
  service_level public.service_level,
  required_vehicle public.vehicle_type,
  created_at timestamptz,
  miles_from_you numeric,
  date_group text,
  matched boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  profile_row public.profiles%rowtype;
  driver_row public.drivers%rowtype;
begin
  if uid is null or public.account_is_suspended(uid) then
    return;
  end if;
  select * into profile_row from public.profiles where profiles.id = uid;
  if not found or profile_row.blocked or profile_row.deleted_at is not null then
    return;
  end if;
  select * into driver_row from public.drivers where drivers.profile_id = uid;
  if not found or driver_row.status = 'removed' or driver_row.driving_stopped_at is not null then
    return;
  end if;
  return query
  select
    j.id, j.service, j.pieces, j.size, j.pickup_area, j.dropoff_area, j.distance_miles,
    j.stairs_pickup, j.stairs_dropoff, j.elevator, j.help_loading, j.preferred_date, j.time_window,
    j.pricing_method,
    case when j.pricing_method = 'fixed' then j.offer_cents else null end,
    case when j.pricing_method = 'range' then j.budget_min_cents else null end,
    case when j.pricing_method = 'range' then j.budget_max_cents else null end,
    case when j.pricing_method = 'quote' then j.driver_pay_cents else null end,
    case when j.pricing_method = 'quote' then j.quote_expires_at else null end,
    j.junk_load_size, j.service_level, j.required_vehicle, j.created_at,
    public.driver_home_miles(uid, j.pickup_area),
    public.feed_date_group(j.preferred_date),
    public.coverage_matches(uid, j.pickup_area)
  from public.jobs j
  where j.status = 'open'
    and (
      j.paused_at is null
      or (
        j.suspension_hold
        and not public.account_is_suspended(j.customer_id)
        and (j.quote_expires_at is null or j.quote_expires_at > now())
      )
    )
    and not public.account_is_suspended(j.customer_id)
    and j.customer_id is distinct from uid
    and (
      not public.waves_enabled()
      or public.job_released_to_driver(uid, j)
    )
    and not exists (
      select 1 from public.customer_driver_blocks
      where customer_id = j.customer_id and driver_id = uid
    );
end;
$$;
