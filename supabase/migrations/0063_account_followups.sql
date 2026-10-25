-- Missing phone secret no longer blocks sign-up or deletion.
-- A quiet phone can be reclaimed after 12 months. Dispute photos wait 365 days
-- after the dispute is resolved. Local until applied.

alter table public.profiles
  add column if not exists reclaim_hold_at timestamptz,
  add column if not exists phone_owner_confirmed_at timestamptz;

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
  insert into public.profiles (id, role, phone, email)
  values (new.id, 'customer', new.phone, new.email);
  if public.phone_hmac_secret() is null then
    insert into public.audit_log (actor_id, action, target_type, target_id, data)
    values (new.id, 'phone_protection_missing', 'profile', new.id, jsonb_build_object('step', 'registration'));
  end if;
  return new;
end;
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
      insert into public.audit_log (actor_id, action, target_type, target_id, data)
      values (actor, 'phone_protection_missing', 'profile', target, jsonb_build_object('step', 'deletion'));
    else
      digest := public.phone_hmac(phone);
      restriction_until := coalesce(suspension.expires_at, now() + interval '3 years');
      if digest is not null and restriction_until > now() then
        insert into public.phone_restrictions (phone_hmac, expires_at, source_profile_id)
        values (digest, restriction_until, target)
        on conflict (phone_hmac) do update
          set expires_at = excluded.expires_at, source_profile_id = excluded.source_profile_id;
      end if;
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

create or replace function public.admin_phone_protection_ready()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return null;
  end if;
  return public.phone_hmac_secret() is not null;
end;
$$;

revoke all on function public.admin_phone_protection_ready() from public, anon, service_role;
grant execute on function public.admin_phone_protection_ready() to authenticated;

create or replace function public.admin_active_admin_count()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return null;
  end if;
  return (
    select count(*)::integer
    from public.profiles
    where role = 'admin' and deleted_at is null and not public.account_is_suspended(id)
  );
end;
$$;

revoke all on function public.admin_active_admin_count() from public, anon, service_role;
grant execute on function public.admin_active_admin_count() to authenticated;

create or replace function public.phone_reclaim_hint()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  profile_row public.profiles%rowtype;
  last_job timestamptz;
  last_touch timestamptz;
  city text;
  when_at timestamptz;
begin
  if uid is null then
    return null;
  end if;
  select * into profile_row from public.profiles where id = uid;
  if not found or profile_row.deleted_at is not null then
    return null;
  end if;
  if profile_row.reclaim_hold_at is not null then
    return jsonb_build_object('blocked', true);
  end if;
  if profile_row.phone_owner_confirmed_at is not null or profile_row.created_at > now() - interval '12 months' then
    return null;
  end if;
  select max(updated_at) into last_job
  from public.jobs
  where customer_id = uid or assigned_driver_id = uid;
  select max(created_at) into last_touch from public.messages where sender_id = uid;
  if greatest(profile_row.created_at, coalesce(last_job, profile_row.created_at), coalesce(last_touch, profile_row.created_at))
    > now() - interval '12 months' then
    return null;
  end if;
  select pickup_area, updated_at into city, when_at
  from public.jobs
  where customer_id = uid
  order by updated_at desc
  limit 1;
  return jsonb_build_object(
    'initial', upper(left(coalesce(nullif(split_part(btrim(coalesce(profile_row.full_name, '')), ' ', 1), ''), '?'), 1)),
    'city', coalesce(nullif(regexp_replace(coalesce(city, ''), '\s*[0-9]{5}.*$', ''), ''), 'no pickup on file'),
    'month', to_char(coalesce(when_at, profile_row.created_at) at time zone 'America/New_York', 'Mon YYYY')
  );
end;
$$;

revoke all on function public.phone_reclaim_hint() from public, anon, service_role;
grant execute on function public.phone_reclaim_hint() to authenticated;

create or replace function public.confirm_phone_owner()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  update public.profiles
  set phone_owner_confirmed_at = now()
  where id = auth.uid();
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (auth.uid(), 'confirm_phone_owner', 'profile', auth.uid(), jsonb_build_object('choice', 'yes'));
end;
$$;

revoke all on function public.confirm_phone_owner() from public, anon, service_role;
grant execute on function public.confirm_phone_owner() to authenticated;

create or replace function public.decline_phone_owner()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if public.phone_reclaim_hint() is null then
    raise exception 'this phone is not ready for a new account';
  end if;
  update public.profiles
  set reclaim_hold_at = now(), phone = null
  where id = uid;
  update auth.users
  set phone = null
  where id = uid;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (uid, 'reclaim_phone_for_review', 'profile', uid, jsonb_build_object('choice', 'new'));
end;
$$;

revoke all on function public.decline_phone_owner() from public, anon, service_role;
grant execute on function public.decline_phone_owner() to authenticated;

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
          and (disputes.resolved_at is null or disputes.resolved_at > now() - interval '365 days')
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
      and (disputes.resolved_at is null or disputes.resolved_at > now() - interval '365 days')
  );
end;
$$;
