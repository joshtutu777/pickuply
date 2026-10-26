-- A test driver application tells test admins only.
-- Notifying a real admin was aborting the application.

create or replace function public.guard_test_lane_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_test boolean;
  new_row jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  old_row jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
begin
  if tg_table_name = 'profiles' and tg_op = 'UPDATE'
    and (new_row ->> 'is_test') is distinct from (old_row ->> 'is_test') then
    if not public.is_migration_session() then
      raise exception 'test classification cannot be changed from the app';
    end if;
  end if;

  if tg_table_name = 'jobs' and tg_op = 'UPDATE'
    and (new_row ->> 'is_test') is distinct from (old_row ->> 'is_test') then
    if not public.is_migration_session() then
      raise exception 'test classification cannot be changed from the app';
    end if;
  end if;

  if tg_table_name = 'jobs' and tg_op <> 'DELETE'
    and nullif(new_row ->> 'assigned_driver_id', '') is not null
    and public.profile_is_test((new_row ->> 'assigned_driver_id')::uuid) is distinct from coalesce((new_row ->> 'is_test')::boolean, false) then
    raise exception 'test and real accounts cannot be booked together';
  end if;

  if tg_table_name = 'job_offers' and tg_op <> 'DELETE'
    and public.profile_is_test((new_row ->> 'driver_id')::uuid) is distinct from public.job_is_test((new_row ->> 'job_id')::uuid) then
    raise exception 'test and real accounts cannot be booked together';
  end if;

  if tg_table_name = 'notifications' and tg_op = 'INSERT' then
    if nullif(new_row ->> 'job_id', '') is not null
      and public.profile_is_test((new_row ->> 'profile_id')::uuid) is distinct from public.job_is_test((new_row ->> 'job_id')::uuid) then
      return null;
    end if;
    if auth.uid() is not null
      and nullif(new_row ->> 'job_id', '') is null
      and public.profile_is_test((new_row ->> 'profile_id')::uuid) is distinct from public.actor_is_test() then
      return null;
    end if;
  end if;

  if tg_table_name = 'job_payments' and tg_op <> 'DELETE' then
    row_test := public.job_is_test((new_row ->> 'job_id')::uuid);
    if row_test and (new_row ->> 'stripe_livemode')::boolean is true then
      raise exception 'a test job cannot use a live Stripe payment';
    end if;
    if nullif(new_row ->> 'payment_intent_id', '') is not null and exists (
      select 1
      from public.job_payments other
      join public.jobs other_job on other_job.id = other.job_id
      where other.payment_intent_id = new_row ->> 'payment_intent_id'
        and other.job_id is distinct from (new_row ->> 'job_id')::uuid
        and other_job.is_test is distinct from row_test
    ) then
      raise exception 'that Stripe payment belongs to the other account lane';
    end if;
  end if;

  if tg_table_name = 'platform_settings' and public.actor_is_test() then
    raise exception 'test accounts cannot change Pickuply settings';
  end if;

  if auth.uid() is null or public.is_migration_session() or not public.actor_is_test() then
    return coalesce(new, old);
  end if;

  if tg_table_name in ('profiles', 'jobs') then
    row_test := coalesce(((case when tg_op = 'DELETE' then old_row else new_row end) ->> 'is_test')::boolean, false);
  elsif tg_table_name = 'drivers' then
    row_test := public.profile_is_test((((case when tg_op = 'DELETE' then old_row else new_row end) ->> 'profile_id'))::uuid);
  elsif tg_table_name in ('job_offers', 'ledger_entries', 'job_payments') then
    row_test := public.job_is_test((((case when tg_op = 'DELETE' then old_row else new_row end) ->> 'job_id'))::uuid);
  elsif tg_table_name = 'notifications' then
    row_test := public.profile_is_test((new_row ->> 'profile_id')::uuid);
  elsif tg_table_name = 'account_suspensions' then
    row_test := public.profile_is_test((((case when tg_op = 'DELETE' then old_row else new_row end) ->> 'profile_id'))::uuid);
  else
    row_test := true;
  end if;

  if not coalesce(row_test, false) then
    raise exception 'test accounts cannot change real account data';
  end if;
  return coalesce(new, old);
end;
$$;
