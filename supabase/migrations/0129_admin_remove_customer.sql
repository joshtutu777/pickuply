-- An admin can remove a customer who has no requests, payments, or disputes.
-- The profile row stays, marked deleted, so the audit record still has a target.
-- The phone is released and the sign-in is disabled. The same phone can register
-- as a new account. Jobs, payments, refunds, and disputes are not deleted.
-- A customer with any of those records is left unchanged.
-- This does not finish a customer's 14-day deletion request early.

create or replace function public.admin_remove_customer(target uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  profile public.profiles%rowtype;
  outcome text;
begin
  if not public.is_admin() then
    raise exception 'only an admin can remove a customer';
  end if;
  if target = actor then
    raise exception 'an admin cannot remove their own account this way';
  end if;

  select * into profile from public.profiles where id = target;
  if not found then
    raise exception 'account not found';
  end if;

  if profile.deleted_at is not null then
    outcome := 'already_removed';
  elsif profile.role is distinct from 'customer'
    or exists (select 1 from public.drivers where profile_id = target) then
    outcome := 'not_customer';
  elsif exists (
    select 1
    from public.job_disputes disputes
    join public.jobs on jobs.id = disputes.job_id
    where disputes.resolved_at is null
      and (jobs.customer_id = target or jobs.assigned_driver_id = target)
  ) then
    outcome := 'has_dispute';
  elsif exists (
    select 1 from public.jobs
    where (customer_id = target or assigned_driver_id = target)
      and status not in ('completed', 'cancelled')
  ) then
    outcome := 'has_active_job';
  elsif exists (
    select 1 from public.jobs
    where (customer_id = target or assigned_driver_id = target)
      and (
        payment_status in ('authorized', 'captured', 'awaiting_payment', 'paid')
        or coalesce(captured_cents, 0) > 0
        or stripe_payment_intent_id is not null
      )
  ) or exists (
    select 1
    from public.job_payments payments
    join public.jobs on jobs.id = payments.job_id
    where jobs.customer_id = target or jobs.assigned_driver_id = target
  ) or exists (
    select 1
    from public.refund_requests refunds
    join public.jobs on jobs.id = refunds.job_id
    where jobs.customer_id = target or jobs.assigned_driver_id = target
  ) or exists (
    select 1 from public.ledger_entries where driver_id = target
  ) then
    outcome := 'has_payment';
  elsif exists (
    select 1 from public.jobs
    where customer_id = target or assigned_driver_id = target
  ) then
    outcome := 'has_jobs';
  else
    outcome := 'removed';
  end if;

  if outcome = 'removed' then
    update public.profiles
    set full_name = 'Deleted account',
        first_name = null,
        last_name = null,
        phone = null,
        email = null,
        photo_url = null,
        deleted_at = now()
    where id = target
      and deleted_at is null;
    if not found then
      outcome := 'already_removed';
    else
      update auth.users
      set phone = null,
          phone_confirmed_at = null,
          phone_change = '',
          phone_change_token = '',
          phone_change_sent_at = null,
          email = null,
          banned_until = 'infinity'
      where id = target;
      delete from auth.identities
      where user_id = target and provider = 'phone';
      delete from public.push_subscriptions where profile_id = target;
      if to_regclass('auth.sessions') is not null then
        delete from auth.sessions where user_id = target;
      end if;
      if to_regclass('auth.refresh_tokens') is not null then
        delete from auth.refresh_tokens where user_id = target::text;
      end if;
    end if;
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    actor,
    'admin_remove_customer',
    'profile',
    target,
    jsonb_build_object('outcome', outcome)
  );
  return outcome;
end;
$$;

revoke all on function public.admin_remove_customer(uuid) from public, anon, service_role;
grant execute on function public.admin_remove_customer(uuid) to authenticated;
