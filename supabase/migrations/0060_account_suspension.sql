-- Account suspension is separate from a driver going Offline or being Paused.
-- Local until the owner applies it. Active bookings and payment rows are left alone.

alter table public.jobs
  add column suspension_hold boolean not null default false;

alter table public.profiles
  add column deleted_at timestamptz;

alter table public.job_offers
  add column unavailable_at timestamptz;

create table public.account_suspensions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id),
  status text not null,
  kind text not null,
  reason text not null,
  note text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id),
  constraint account_suspensions_status check (status in ('active', 'reinstated', 'expired')),
  constraint account_suspensions_kind check (kind in ('temporary', 'indefinite')),
  constraint account_suspensions_reason check (char_length(btrim(reason)) between 3 and 500),
  constraint account_suspensions_window check (
    (kind = 'indefinite' and expires_at is null)
    or (kind = 'temporary' and expires_at is not null)
  )
);

create unique index account_suspensions_one_active
  on public.account_suspensions (profile_id)
  where status = 'active';

alter table public.account_suspensions enable row level security;

create policy account_suspensions_admin on public.account_suspensions
  for select to authenticated
  using (public.is_admin());

revoke all on public.account_suspensions from public, anon, authenticated, service_role;
grant select on public.account_suspensions to authenticated;

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id),
  status text not null,
  blockers text[] not null default '{}',
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references public.profiles (id),
  constraint account_deletion_status check (status in ('pending', 'completed', 'deferred'))
);

create unique index account_deletion_one_open
  on public.account_deletion_requests (profile_id)
  where status in ('pending', 'deferred');

alter table public.account_deletion_requests enable row level security;

create policy account_deletion_select on public.account_deletion_requests
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

revoke all on public.account_deletion_requests from public, anon, authenticated, service_role;
grant select on public.account_deletion_requests to authenticated;

create table public.phone_restrictions (
  phone_hmac text primary key,
  expires_at timestamptz,
  source_profile_id uuid,
  created_at timestamptz not null default now()
);

alter table public.phone_restrictions enable row level security;
revoke all on public.phone_restrictions from public, anon, authenticated, service_role;

create or replace function public.account_is_suspended(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.account_suspensions
    where profile_id = target
      and status = 'active'
      and (expires_at is null or expires_at > now())
  );
$$;

revoke all on function public.account_is_suspended(uuid) from public, anon, authenticated, service_role;

create or replace function public.my_account_restriction()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  row public.account_suspensions%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('active', false);
  end if;
  select * into row
  from public.account_suspensions
  where profile_id = auth.uid()
    and status = 'active'
    and (expires_at is null or expires_at > now())
  order by created_at desc
  limit 1;
  if not found then
    return jsonb_build_object('active', false);
  end if;
  return jsonb_build_object(
    'active', true,
    'kind', row.kind,
    'expires_at', row.expires_at
  );
end;
$$;

revoke all on function public.my_account_restriction() from public, anon, service_role;
grant execute on function public.my_account_restriction() to authenticated;

create or replace function public.my_phone_restricted()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.phone_is_restricted(phone), false)
  from public.profiles
  where id = auth.uid();
$$;

revoke all on function public.my_phone_restricted() from public, anon, service_role;
grant execute on function public.my_phone_restricted() to authenticated;

create or replace function public.normalize_phone(raw text)
returns text
language sql
immutable
as $$
  select case
    when raw is null then null
    when length(regexp_replace(raw, '\D', '', 'g')) = 10
      then '+1' || regexp_replace(raw, '\D', '', 'g')
    when length(regexp_replace(raw, '\D', '', 'g')) = 11
      and left(regexp_replace(raw, '\D', '', 'g'), 1) = '1'
      then '+' || regexp_replace(raw, '\D', '', 'g')
    else null
  end;
$$;

create or replace function public.phone_hmac(raw text)
returns text
language plpgsql
stable
as $$
declare
  secret text := current_setting('pickuply.phone_hmac_secret', true);
  phone text := public.normalize_phone(raw);
begin
  if secret is null or secret = '' or phone is null then
    return null;
  end if;
  return encode(extensions.hmac(phone, secret, 'sha256'), 'hex');
end;
$$;

revoke all on function public.phone_hmac(text) from public, anon, authenticated, service_role;

create or replace function public.phone_is_restricted(raw text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.phone_hmac(raw) is not null and exists (
    select 1 from public.phone_restrictions
    where phone_hmac = public.phone_hmac(raw)
      and (expires_at is null or expires_at > now())
  );
$$;

revoke all on function public.phone_is_restricted(text) from public, anon, authenticated, service_role;

create or replace function public.other_active_admins(except_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.profiles
  where role = 'admin'
    and deleted_at is null
    and id is distinct from except_id
    and not public.account_is_suspended(id);
$$;

revoke all on function public.other_active_admins(uuid) from public, anon, authenticated, service_role;

create or replace function public.suspend_account(
  target uuid,
  kind text,
  reason text,
  expires_at timestamptz,
  note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target_role text;
  existing uuid;
  suspension_id uuid;
  clean_reason text := btrim(coalesce(reason, ''));
  job_row record;
begin
  perform set_config('pickuply.admin_pause', 'yes', true);
  if not public.is_admin() then
    raise exception 'only an admin can suspend an account';
  end if;
  if target = uid then
    raise exception 'an admin cannot suspend their own account';
  end if;
  if clean_reason = '' or char_length(clean_reason) > 500 then
    raise exception 'a suspension reason is required';
  end if;
  if kind not in ('temporary', 'indefinite') then
    raise exception 'choose a temporary or indefinite suspension';
  end if;
  if kind = 'temporary' and (expires_at is null or expires_at <= now()) then
    raise exception 'a temporary suspension needs a future end time';
  end if;
  if kind = 'indefinite' then
    expires_at := null;
  end if;
  select role into target_role from public.profiles where id = target and deleted_at is null;
  if target_role is null then
    raise exception 'account not found';
  end if;
  if target_role = 'admin' and public.other_active_admins(target) = 0 then
    raise exception 'the last active admin cannot be suspended';
  end if;

  select id into existing
  from public.account_suspensions
  where profile_id = target and status = 'active';
  if existing is not null then
    update public.account_suspensions
    set kind = suspend_account.kind,
        reason = clean_reason,
        note = nullif(btrim(coalesce(suspend_account.note, '')), ''),
        expires_at = suspend_account.expires_at
    where id = existing
    returning id into suspension_id;
    insert into public.audit_log (actor_id, action, target_type, target_id, data)
    values (uid, 'extend_suspension', 'profile', target, jsonb_build_object('kind', kind, 'expires_at', expires_at));
  else
    insert into public.account_suspensions (profile_id, status, kind, reason, note, expires_at, created_by)
    values (target, 'active', kind, clean_reason, nullif(btrim(coalesce(note, '')), ''), expires_at, uid)
    returning id into suspension_id;
    insert into public.audit_log (actor_id, action, target_type, target_id, data)
    values (uid, 'suspend_account', 'profile', target, jsonb_build_object('kind', kind, 'expires_at', expires_at, 'previous', 'active'));
  end if;

  update public.jobs
  set paused_at = now(), suspension_hold = true
  where customer_id = target
    and status = 'open'
    and paused_at is null
    and assigned_driver_id is null;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  select uid, 'pause_request_for_suspension', 'job', id, jsonb_build_object('profile_id', target)
  from public.jobs
  where customer_id = target and suspension_hold and status = 'open' and assigned_driver_id is null;

  update public.job_offers
  set status = 'expired', unavailable_at = now()
  where driver_id = target and status = 'active';

  perform public.enqueue_notification(
    target, null,
    'account_restricted',
    'Account restricted',
    case
      when kind = 'temporary' then 'Your Pickuply account is temporarily restricted. You cannot create or book new pickups, or accept new jobs, while this restriction is active.'
      else 'Your Pickuply account is restricted. You cannot create or book new pickups, or accept new jobs, while this restriction is active.'
    end,
    '/account',
    'account-restricted:' || suspension_id::text
  );

  for job_row in
    select id from public.jobs
    where (customer_id = target or assigned_driver_id = target)
      and status in ('assigned', 'en_route', 'arrived', 'item_check', 'in_transit', 'delivered')
  loop
    perform public.notify_admins(
      job_row.id, 'account_restricted',
      'Restricted account has an active job',
      'An account restriction did not cancel this booking. It needs a look.',
      '/admin/requests/' || job_row.id::text,
      'restricted-active-job:' || job_row.id::text || ':' || target::text
    );
  end loop;
  return suspension_id;
end;
$$;

create or replace function public.reinstate_account(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  perform set_config('pickuply.admin_pause', 'yes', true);
  if not public.is_admin() then
    raise exception 'only an admin can reinstate an account';
  end if;
  update public.account_suspensions
  set status = 'reinstated', ended_at = now(), ended_by = uid
  where profile_id = target and status = 'active';
  if not found then
    raise exception 'this account is not suspended';
  end if;
  update public.jobs
  set paused_at = null, suspension_hold = false
  where customer_id = target
    and suspension_hold
    and status = 'open'
    and assigned_driver_id is null
    and (quote_expires_at is null or quote_expires_at > now());
  update public.jobs
  set suspension_hold = false
  where customer_id = target and suspension_hold;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (uid, 'reinstate_account', 'profile', target, jsonb_build_object('previous', 'suspended', 'next', 'active'));
  perform public.enqueue_notification(
    target, null, 'account_reinstated',
    'Account restored',
    'Your Pickuply account can be used again. Offers that were closed are not restored.',
    '/account',
    'account-reinstated:' || target::text || ':' || floor(extract(epoch from now()))::text
  );
end;
$$;

create or replace function public.expire_due_suspensions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.account_suspensions%rowtype;
begin
  perform set_config('pickuply.admin_pause', 'yes', true);
  for row in
    select * from public.account_suspensions
    where status = 'active' and expires_at is not null and expires_at <= now()
  loop
    update public.account_suspensions
    set status = 'expired', ended_at = now()
    where id = row.id and status = 'active';
    update public.jobs
    set paused_at = null, suspension_hold = false
    where customer_id = row.profile_id
      and suspension_hold
      and status = 'open'
      and assigned_driver_id is null
      and (quote_expires_at is null or quote_expires_at > now());
    update public.jobs set suspension_hold = false
    where customer_id = row.profile_id and suspension_hold;
    insert into public.audit_log (actor_id, action, target_type, target_id, data)
    values (null, 'expire_suspension', 'profile', row.profile_id, jsonb_build_object('suspension_id', row.id));
  end loop;
end;
$$;

revoke all on function public.suspend_account(uuid, text, text, timestamptz, text) from public, anon, service_role;
revoke all on function public.reinstate_account(uuid) from public, anon, service_role;
revoke all on function public.expire_due_suspensions() from public, anon, authenticated, service_role;
grant execute on function public.suspend_account(uuid, text, text, timestamptz, text) to authenticated;
grant execute on function public.reinstate_account(uuid) to authenticated;
grant execute on function public.expire_due_suspensions() to service_role;

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
      select 1 from public.jobs
      where (customer_id = target or assigned_driver_id = target)
        and payment_status in ('authorized', 'awaiting_payment')
    ) then 'open_payment' end,
    case when exists (
      select 1 from public.job_disputes disputes
      join public.jobs on jobs.id = disputes.job_id
      where disputes.resolved_at is null
        and (jobs.customer_id = target or jobs.assigned_driver_id = target)
    ) then 'open_dispute' end,
    case when exists (
      select 1 from public.ledger_entries
      where driver_id = target
        and status in ('pending', 'held', 'held_until_onboarding', 'ready', 'recovery_due')
    ) then 'open_earnings' end,
    case when exists (
      select 1 from public.recovery_obligations
      where driver_id = target and status = 'recovery_due'
    ) then 'recovery_due' end
  ], null), '{}');
$$;

revoke all on function public.deletion_blockers(uuid) from public, anon, authenticated, service_role;

create or replace function public.finish_account_deletion(target uuid, actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  phone text;
  digest text;
  suspension public.account_suspensions%rowtype;
begin
  select profiles.phone into phone from public.profiles where id = target;
  select * into suspension
  from public.account_suspensions
  where profile_id = target and status = 'active'
    and (expires_at is null or expires_at > now());
  digest := public.phone_hmac(phone);
  if suspension.id is not null and digest is not null then
    insert into public.phone_restrictions (phone_hmac, expires_at, source_profile_id)
    values (digest, suspension.expires_at, target)
    on conflict (phone_hmac) do update
      set expires_at = excluded.expires_at, source_profile_id = excluded.source_profile_id;
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

revoke all on function public.finish_account_deletion(uuid, uuid) from public, anon, authenticated, service_role;

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
  request_id uuid;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select role, deleted_at into role_name, signed_in from public.profiles where id = uid;
  if signed_in is not null and role_name is null then
    raise exception 'account not found';
  end if;
  if (select deleted_at from public.profiles where id = uid) is not null then
    raise exception 'this account is already deleted';
  end if;
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
  if role_name = 'admin' or cardinality(blockers) > 0 then
    insert into public.account_deletion_requests (profile_id, status, blockers)
    values (uid, 'pending', blockers)
    returning id into request_id;
    insert into public.audit_log (actor_id, action, target_type, target_id, data)
    values (uid, 'request_account_deletion', 'profile', uid, jsonb_build_object('status', 'pending', 'blockers', blockers));
    return 'pending';
  end if;
  insert into public.account_deletion_requests (profile_id, status, blockers)
  values (uid, 'pending', '{}')
  returning id into request_id;
  perform public.finish_account_deletion(uid, uid);
  return 'completed';
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
  blockers := public.deletion_blockers(target);
  if cardinality(blockers) > 0 then
    raise exception 'this account still has obligations';
  end if;
  if not exists (
    select 1 from public.account_deletion_requests
    where profile_id = target and status in ('pending', 'deferred')
  ) then
    insert into public.account_deletion_requests (profile_id, status) values (target, 'pending');
  end if;
  perform public.finish_account_deletion(target, auth.uid());
end;
$$;

create or replace function public.defer_account_deletion(target uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := btrim(coalesce(reason, ''));
begin
  if not public.is_admin() then
    raise exception 'only an admin can defer account deletion';
  end if;
  if char_length(clean) < 3 or char_length(clean) > 500 then
    raise exception 'a reason is required';
  end if;
  update public.account_deletion_requests
  set status = 'deferred', updated_at = now()
  where profile_id = target and status = 'pending';
  if not found then
    raise exception 'there is no pending deletion request';
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (auth.uid(), 'defer_account_deletion', 'profile', target, jsonb_build_object('status', 'deferred'));
end;
$$;

revoke all on function public.request_account_deletion() from public, anon, service_role;
revoke all on function public.complete_account_deletion(uuid) from public, anon, service_role;
revoke all on function public.defer_account_deletion(uuid, text) from public, anon, service_role;
grant execute on function public.request_account_deletion() to authenticated;
grant execute on function public.complete_account_deletion(uuid) to authenticated;
grant execute on function public.defer_account_deletion(uuid, text) to authenticated;

create or replace function public.enforce_new_request_suspension()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.account_is_suspended(new.customer_id) then
    raise exception 'Your Pickuply account is restricted. You cannot create or book new pickups while this restriction is active.';
  end if;
  if public.phone_is_restricted((select phone from public.profiles where id = new.customer_id)) then
    raise exception 'This phone number cannot be used for Pickuply right now. Contact support if you think this is a mistake.';
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_enforce_suspension on public.jobs;
create trigger jobs_enforce_suspension
  before insert on public.jobs
  for each row execute function public.enforce_new_request_suspension();

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
  if not found or driver_row.status not in ('active', 'approved_new') then
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

create or replace function public.choose_offer(target_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  offer_row public.job_offers%rowtype;
  job_row public.jobs%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if public.account_is_suspended(uid) then
    raise exception 'Your Pickuply account is restricted. You cannot create or book new pickups while this restriction is active.';
  end if;
  select * into offer_row from public.job_offers where id = target_offer;
  if not found or offer_row.status <> 'active' or offer_row.expires_at <= now() or offer_row.unavailable_at is not null then
    raise exception 'that offer is no longer available';
  end if;
  if public.account_is_suspended(offer_row.driver_id) then
    raise exception 'that offer is no longer available';
  end if;
  select * into job_row from public.jobs where id = offer_row.job_id for update;
  if not found or job_row.status <> 'open' then
    raise exception 'job already taken';
  end if;
  if job_row.customer_id is distinct from uid then
    raise exception 'only the customer can choose an offer on an open job';
  end if;
  select * into offer_row from public.job_offers where id = target_offer for update;
  if not found or offer_row.status <> 'active' or offer_row.expires_at <= now() or offer_row.unavailable_at is not null then
    raise exception 'that offer is no longer available';
  end if;
  perform set_config('pickuply.offer_chosen', 'yes', true);
  update public.job_offers set status = 'chosen' where id = target_offer;
  update public.job_offers
  set status = 'declined'
  where job_id = offer_row.job_id and id <> target_offer and status = 'active';
  update public.jobs
  set
    status = 'assigned',
    assigned_driver_id = offer_row.driver_id,
    accepted_offer_id = target_offer,
    price_cents = offer_row.customer_total_cents,
    driver_pay_cents = offer_row.driver_amount_cents,
    platform_fee_cents = offer_row.platform_fee_cents,
    service_fee_cents = offer_row.service_fee_cents,
    payment_status = 'awaiting_payment',
    payment_due_at = public.payment_due_at()
  where id = offer_row.job_id;
  insert into public.job_events (job_id, actor_id, type, data)
  values (
    offer_row.job_id, uid, 'offer_chosen',
    jsonb_build_object('offer_id', target_offer, 'to', 'assigned')
  );
end;
$function$;

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
  if not found or driver_row.status = 'removed' then
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
