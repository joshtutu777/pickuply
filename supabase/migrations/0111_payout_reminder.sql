-- Approved drivers get one in-app alert to add payout details.
-- A driver who already finished payout setup is not reminded.
-- This does not add a text message.

create or replace function public.remind_payout_setup(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target is null then
    return;
  end if;
  if auth.uid() is distinct from target
    and not public.is_admin()
    and not public.is_migration_session() then
    raise exception 'sign in required';
  end if;
  if not exists (
    select 1 from public.drivers
    where profile_id = target
      and status in ('active', 'approved_new')
  ) then
    return;
  end if;
  if exists (
    select 1 from public.driver_connect_accounts
    where driver_id = target and payouts_enabled
  ) then
    return;
  end if;
  perform public.enqueue_notification(
    target,
    null,
    'payout_setup',
    'Add your payout details',
    'Add your payout details so Pickuply can pay you after a completed job. Earnings stay held until this is done.',
    '/driver/earnings',
    'payout-details:' || target::text
  );
end;
$$;

create or replace function public.remind_payout_setup()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  perform public.remind_payout_setup(auth.uid());
end;
$$;

revoke all on function public.remind_payout_setup(uuid) from public, anon, authenticated, service_role;
revoke all on function public.remind_payout_setup() from public, anon, service_role;
grant execute on function public.remind_payout_setup() to authenticated;

create or replace function public.notify_missing_payout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('active', 'approved_new')
    and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.remind_payout_setup(new.profile_id);
  end if;
  return new;
end;
$$;

drop trigger if exists drivers_payout_reminder on public.drivers;
create trigger drivers_payout_reminder
  after insert or update of status on public.drivers
  for each row execute function public.notify_missing_payout();
