-- A repeated confirmation can fill in the Stripe fee once the balance transaction exists.
-- It does not add a second ledger row.
-- Do not apply this file to the hosted project until the owner approves it.

create or replace function public.confirm_tip_payment(
  target_tip uuid,
  payment_intent text,
  charge_id text,
  fee_cents integer,
  live boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  tip_row public.job_tips%rowtype;
  job_row public.jobs%rowtype;
  customer_name text;
  dollars text;
  net_cents integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  if coalesce(live, false) then
    raise exception 'live payments are not enabled';
  end if;
  select * into tip_row from public.job_tips where id = target_tip for update;
  if not found then
    raise exception 'tip not found';
  end if;
  if tip_row.stripe_payment_intent_id is not null and tip_row.stripe_payment_intent_id is distinct from payment_intent then
    raise exception 'this tip already has a payment';
  end if;
  if tip_row.paid_at is not null then
    if tip_row.stripe_fee_cents is null and fee_cents is not null then
      update public.job_tips
      set stripe_fee_cents = fee_cents, updated_at = now()
      where id = target_tip;
    end if;
    return 'duplicate';
  end if;
  select * into job_row from public.jobs where id = tip_row.job_id;
  if job_row.is_test and coalesce(live, false) then
    raise exception 'a test job cannot take a live charge';
  end if;
  net_cents := greatest(tip_row.amount_cents - tip_row.refunded_cents, 0);
  update public.job_tips
  set status = case
        when refunded_cents >= amount_cents then 'refunded'
        else 'succeeded'
      end,
      stripe_payment_intent_id = payment_intent,
      stripe_charge_id = charge_id,
      stripe_fee_cents = fee_cents,
      paid_at = now(),
      updated_at = now()
  where id = target_tip;
  insert into public.ledger_entries (
    job_id, driver_id, amount_cents, status, available_on, entry_kind, tip_id
  ) values (
    tip_row.job_id, tip_row.driver_id, net_cents, 'pending', now(), 'tip', target_tip
  )
  on conflict (tip_id) do nothing;
  if net_cents = 0 then
    return 'paid';
  end if;
  select coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'Your customer')
  into customer_name
  from public.profiles
  where id = tip_row.customer_id;
  dollars := case
    when net_cents % 100 = 0 then '$' || (net_cents / 100)::text
    else '$' || to_char(net_cents / 100.0, 'FM999990.00')
  end;
  perform public.enqueue_notification(
    tip_row.driver_id,
    tip_row.job_id,
    'tip',
    'You got a tip',
    'You got a ' || dollars || ' tip from ' || customer_name || '!',
    '/driver/earnings',
    'tip:' || target_tip::text
  );
  return 'paid';
end;
$$;

revoke all on function public.confirm_tip_payment(uuid, text, text, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.confirm_tip_payment(uuid, text, text, integer, boolean) to service_role;
