-- An admin can delete an account immediately when no job or money blocker is open.
-- The phone is removed from sign-in so the same number can register as a new account.
-- Open jobs and unpaid money stay in place. The 14-day self-service request is unchanged.

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
  release_phone boolean := coalesce(current_setting('pickuply.release_phone', true), '') = 'yes';
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
  if not release_phone and (suspension.id is not null or removed) then
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
  update auth.users
  set phone = null
  where id = target;
  if to_regclass('auth.identities') is not null then
    delete from auth.identities
    where user_id = target and provider = 'phone';
  end if;
  perform set_config('pickuply.driver_online', 'yes', true);
  update public.drivers
  set is_online = false
  where profile_id = target and is_online;
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
  values (actor, 'complete_account_deletion', 'profile', target, jsonb_build_object('next', 'deleted', 'phone_released', release_phone));
end;
$$;

create or replace function public.admin_release_account(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  role_name text;
  blockers text[];
begin
  perform set_config('pickuply.admin_pause', 'yes', true);
  if not public.is_admin() then
    raise exception 'only an admin can delete an account';
  end if;
  if target = auth.uid() then
    raise exception 'an admin cannot delete their own account this way';
  end if;
  select role into role_name
  from public.profiles
  where id = target and deleted_at is null;
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
  update public.account_suspensions
  set status = 'reinstated', ended_at = now(), ended_by = auth.uid()
  where profile_id = target and status = 'active';
  if not exists (
    select 1 from public.account_deletion_requests
    where profile_id = target and status in ('pending', 'deferred')
  ) then
    insert into public.account_deletion_requests (profile_id, status, blockers, grace_ends_at)
    values (target, 'pending', '{}', now());
  end if;
  perform set_config('pickuply.release_phone', 'yes', true);
  perform public.finish_account_deletion(target, auth.uid());
end;
$$;

revoke all on function public.admin_release_account(uuid) from public, anon, service_role;
grant execute on function public.admin_release_account(uuid) to authenticated;
