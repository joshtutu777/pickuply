-- Not applied. A recorded Stripe mode cannot be flipped.
-- A blank mode can be set once. The same value can be sent again.
-- True cannot become false, and false cannot become true.
-- Existing payment and transfer rows are left as they are.

create or replace function public.guard_job_payment_livemode()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.stripe_livemode is not null
    and old.stripe_livemode is distinct from new.stripe_livemode then
    raise exception 'payment mode is already recorded';
  end if;
  return new;
end;
$$;

drop trigger if exists job_payments_livemode_guard on public.job_payments;
create trigger job_payments_livemode_guard
  before update on public.job_payments
  for each row
  execute function public.guard_job_payment_livemode();

revoke all on function public.guard_job_payment_livemode() from public, anon, authenticated, service_role;

create or replace function public.note_stripe_livemode(target_job uuid, live boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  saved boolean;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' and not public.is_migration_session() then
    raise exception 'service role required';
  end if;

  select stripe_livemode into saved
  from public.job_payments
  where job_id = target_job
  for update;

  if not found then
    return;
  end if;

  if saved is null then
    update public.job_payments
    set stripe_livemode = coalesce(live, false),
        updated_at = now()
    where job_id = target_job;
    return;
  end if;

  if saved is not distinct from coalesce(live, false) then
    return;
  end if;

  raise exception 'payment mode is already recorded';
end;
$$;

revoke all on function public.note_stripe_livemode(uuid, boolean) from public, anon, authenticated;
grant execute on function public.note_stripe_livemode(uuid, boolean) to service_role;
