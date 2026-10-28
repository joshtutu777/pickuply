-- Optional post-delivery tips. The driver receives 100%. Pickuply takes no
-- commission and no service fee. A tip is its own payment and its own ledger
-- row. This file does not rewrite booking prices, base earnings, or refunds.
-- Number 0102 follows 0101. It does not replace 0098 through 0101.

alter table public.jobs
  add column completed_at timestamptz;

create or replace function public.remember_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_remember_completed_at on public.jobs;
create trigger jobs_remember_completed_at
  before update of status on public.jobs
  for each row execute function public.remember_completed_at();

update public.jobs
set completed_at = coalesce(
  (
    select notifications.created_at
    from public.notifications
    where notifications.job_id = jobs.id and notifications.kind = 'completed'
    order by notifications.created_at
    limit 1
  ),
  updated_at
)
where status = 'completed' and completed_at is null;

create table public.customer_payment_consents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id),
  scope text not null check (scope = 'tips_and_future_bookings'),
  stripe_customer_id text,
  consented_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index customer_payment_consents_one_active
  on public.customer_payment_consents (customer_id)
  where revoked_at is null;

create table public.customer_payment_methods (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id),
  stripe_customer_id text not null,
  stripe_payment_method_id text not null unique,
  brand text,
  last4 text,
  detached_at timestamptz,
  created_at timestamptz not null default now(),
  constraint customer_payment_methods_last4 check (last4 is null or last4 ~ '^[0-9]{4}$'),
  constraint customer_payment_methods_brand check (brand is null or char_length(brand) <= 40)
);

create table public.job_tips (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  customer_id uuid not null references public.profiles (id),
  driver_id uuid not null references public.profiles (id),
  amount_cents integer not null check (amount_cents between 100 and 20000),
  status text not null check (status in ('pending', 'requires_action', 'succeeded', 'failed', 'refunded')),
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  stripe_fee_cents integer,
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_tips_refund_cap check (refunded_cents <= amount_cents)
);

create unique index job_tips_one_open
  on public.job_tips (job_id)
  where status in ('pending', 'requires_action');

create unique index job_tips_one_collected
  on public.job_tips (job_id)
  where paid_at is not null;

create table public.tip_refunds (
  id uuid primary key default gen_random_uuid(),
  tip_id uuid not null references public.job_tips (id),
  amount_cents integer not null check (amount_cents > 0),
  reason text not null,
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  stripe_refund_id text unique,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.ledger_entries drop constraint ledger_entries_job_id_key;
alter table public.ledger_entries
  add column entry_kind text not null default 'base' check (entry_kind in ('base', 'tip')),
  add column tip_id uuid unique references public.job_tips (id);

create unique index ledger_entries_one_base
  on public.ledger_entries (job_id)
  where entry_kind = 'base';

alter table public.customer_payment_consents enable row level security;
alter table public.customer_payment_methods enable row level security;
alter table public.job_tips enable row level security;
alter table public.tip_refunds enable row level security;

create policy payment_consent_read on public.customer_payment_consents
  for select to authenticated
  using (customer_id = auth.uid() or public.is_admin());

create policy payment_method_read on public.customer_payment_methods
  for select to authenticated
  using (customer_id = auth.uid() or public.is_admin());

create policy job_tips_read on public.job_tips
  for select to authenticated
  using (
    customer_id = auth.uid()
    or driver_id = auth.uid()
    or public.is_admin()
  );

create policy tip_refund_read on public.tip_refunds
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.job_tips
      where job_tips.id = tip_refunds.tip_id and job_tips.customer_id = auth.uid()
    )
  );

revoke all on public.customer_payment_consents from public, anon, authenticated;
revoke all on public.customer_payment_methods from public, anon, authenticated;
revoke all on public.job_tips from public, anon, authenticated;
revoke all on public.tip_refunds from public, anon, authenticated;
grant select on public.customer_payment_consents to authenticated;
grant select on public.customer_payment_methods to authenticated;
grant select on public.job_tips to authenticated;
grant select on public.tip_refunds to authenticated;

create or replace function public.record_card_consent()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  insert into public.customer_payment_consents (customer_id, scope)
  select auth.uid(), 'tips_and_future_bookings'
  where not exists (
    select 1 from public.customer_payment_consents
    where customer_id = auth.uid() and revoked_at is null
  );
end;
$$;

create or replace function public.revoke_card_consent()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  update public.customer_payment_consents
  set revoked_at = now()
  where customer_id = auth.uid() and revoked_at is null;
end;
$$;

create or replace function public.save_payment_method(
  target_customer uuid,
  stripe_customer text,
  payment_method text,
  card_brand text,
  card_last4 text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  if payment_method is null or payment_method !~ '^pm_' then
    raise exception 'payment method is not valid';
  end if;
  if not exists (
    select 1 from public.customer_payment_consents
    where customer_id = target_customer and revoked_at is null
  ) then
    return;
  end if;
  insert into public.customer_payment_methods (
    customer_id, stripe_customer_id, stripe_payment_method_id, brand, last4
  ) values (
    target_customer, stripe_customer, payment_method, left(card_brand, 40), card_last4
  )
  on conflict (stripe_payment_method_id) do nothing;
  update public.customer_payment_consents
  set stripe_customer_id = stripe_customer
  where customer_id = target_customer and revoked_at is null;
end;
$$;

create or replace function public.detach_payment_method(payment_method text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  update public.customer_payment_methods
  set detached_at = now()
  where stripe_payment_method_id = payment_method
    and customer_id = auth.uid()
    and detached_at is null;
  if not found then
    raise exception 'that card was not found';
  end if;
end;
$$;

create or replace function public.begin_tip(target_job uuid, amount_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
  finished_at timestamptz;
  existing public.job_tips%rowtype;
  created public.job_tips%rowtype;
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  if amount_cents is null or amount_cents < 100 or amount_cents > 20000 then
    raise exception 'a tip must be from $1 to $200';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found then
    raise exception 'job not found';
  end if;
  if job_row.customer_id is distinct from auth.uid() then
    raise exception 'only the customer can tip';
  end if;
  if job_row.status is distinct from 'completed' or job_row.assigned_driver_id is null then
    raise exception 'a tip is available after the job is completed';
  end if;
  if job_row.assigned_driver_id = auth.uid() then
    raise exception 'you cannot tip yourself';
  end if;
  finished_at := coalesce(job_row.completed_at, job_row.updated_at);
  if finished_at < now() - interval '7 days' then
    raise exception 'the tip window has closed';
  end if;
  if exists (
    select 1 from public.job_tips
    where job_id = target_job and paid_at is not null
  ) then
    raise exception 'this job already has a tip';
  end if;
  select * into existing
  from public.job_tips
  where job_id = target_job and status in ('pending', 'requires_action')
  for update;
  if found then
    if existing.amount_cents is distinct from amount_cents then
      raise exception 'a tip is already in progress';
    end if;
    return jsonb_build_object('tip_id', existing.id, 'amount_cents', existing.amount_cents, 'status', existing.status);
  end if;
  insert into public.job_tips (job_id, customer_id, driver_id, amount_cents, status)
  values (target_job, job_row.customer_id, job_row.assigned_driver_id, amount_cents, 'pending')
  returning * into created;
  return jsonb_build_object('tip_id', created.id, 'amount_cents', created.amount_cents, 'status', created.status);
end;
$$;

create or replace function public.note_tip_intent(target_tip uuid, payment_intent text, next_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  if next_status not in ('pending', 'requires_action', 'failed') then
    raise exception 'that tip status is not valid';
  end if;
  update public.job_tips
  set stripe_payment_intent_id = coalesce(stripe_payment_intent_id, payment_intent),
      status = case when paid_at is null then next_status else status end,
      updated_at = now()
  where id = target_tip
    and (stripe_payment_intent_id is null or stripe_payment_intent_id = payment_intent);
end;
$$;

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
    return 'duplicate';
  end if;
  select * into job_row from public.jobs where id = tip_row.job_id;
  if job_row.is_test and coalesce(live, false) then
    raise exception 'a test job cannot take a live charge';
  end if;
  update public.job_tips
  set status = 'succeeded',
      stripe_payment_intent_id = payment_intent,
      stripe_charge_id = charge_id,
      stripe_fee_cents = fee_cents,
      paid_at = now(),
      updated_at = now()
  where id = target_tip;
  insert into public.ledger_entries (
    job_id, driver_id, amount_cents, status, available_on, entry_kind, tip_id
  ) values (
    tip_row.job_id, tip_row.driver_id, tip_row.amount_cents, 'pending', now(), 'tip', target_tip
  )
  on conflict (tip_id) do nothing;
  select coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'Your customer')
  into customer_name
  from public.profiles
  where id = tip_row.customer_id;
  dollars := case
    when tip_row.amount_cents % 100 = 0 then '$' || (tip_row.amount_cents / 100)::text
    else '$' || to_char(tip_row.amount_cents / 100.0, 'FM999990.00')
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

create or replace function public.fail_tip(target_tip uuid, payment_intent text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  update public.job_tips
  set status = 'failed', updated_at = now()
  where id = target_tip
    and paid_at is null
    and (stripe_payment_intent_id is null or stripe_payment_intent_id = payment_intent);
end;
$$;

create or replace function public.begin_tip_refund(target_tip uuid, amount_cents integer, reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tip_row public.job_tips%rowtype;
  ledger_row public.ledger_entries%rowtype;
  refund_id uuid;
  remaining integer;
begin
  if not public.is_admin() then
    raise exception 'only an admin can refund a tip';
  end if;
  if amount_cents is null or amount_cents <= 0 or length(btrim(coalesce(reason, ''))) < 3 then
    raise exception 'enter an amount and a reason';
  end if;
  select * into tip_row from public.job_tips where id = target_tip for update;
  if not found or tip_row.paid_at is null or tip_row.stripe_charge_id is null then
    raise exception 'this tip cannot be refunded';
  end if;
  remaining := tip_row.amount_cents - tip_row.refunded_cents;
  if amount_cents > remaining then
    raise exception 'that refund is larger than the tip';
  end if;
  insert into public.tip_refunds (tip_id, amount_cents, reason, status, created_by)
  values (target_tip, amount_cents, left(btrim(reason), 500), 'pending', auth.uid())
  returning id into refund_id;
  select * into ledger_row from public.ledger_entries where tip_id = target_tip;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(), 'request_tip_refund', 'job_tip', target_tip,
    jsonb_build_object('refund_id', refund_id, 'amount_cents', amount_cents)
  );
  return jsonb_build_object(
    'refund_id', refund_id,
    'charge_id', tip_row.stripe_charge_id,
    'amount_cents', amount_cents,
    'transferred', ledger_row.status = 'transferred'
  );
end;
$$;

create or replace function public.apply_tip_refund(
  target_refund uuid,
  stripe_refund_id text,
  succeeded boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  refund_row public.tip_refunds%rowtype;
  tip_row public.job_tips%rowtype;
  ledger_row public.ledger_entries%rowtype;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  select * into refund_row from public.tip_refunds where id = target_refund for update;
  if not found then
    raise exception 'tip refund not found';
  end if;
  if refund_row.status = 'succeeded' then
    return;
  end if;
  if not succeeded then
    update public.tip_refunds
    set status = 'failed', stripe_refund_id = coalesce(tip_refunds.stripe_refund_id, apply_tip_refund.stripe_refund_id)
    where id = target_refund;
    return;
  end if;
  select * into tip_row from public.job_tips where id = refund_row.tip_id for update;
  if refund_row.amount_cents > tip_row.amount_cents - tip_row.refunded_cents then
    raise exception 'that refund is larger than the tip';
  end if;
  update public.job_tips
  set refunded_cents = refunded_cents + refund_row.amount_cents,
      status = case
        when refunded_cents + refund_row.amount_cents = amount_cents then 'refunded'
        else status
      end,
      updated_at = now()
  where id = tip_row.id;
  update public.tip_refunds
  set status = 'succeeded', stripe_refund_id = apply_tip_refund.stripe_refund_id
  where id = target_refund;
  select * into ledger_row from public.ledger_entries where tip_id = tip_row.id for update;
  if ledger_row.id is null then
    return;
  end if;
  if ledger_row.status = 'transferred' then
    insert into public.recovery_obligations (ledger_id, job_id, driver_id, amount_cents, status, reason)
    values (
      ledger_row.id, ledger_row.job_id, ledger_row.driver_id, refund_row.amount_cents,
      'recovery_due', 'tip refund ' || target_refund::text
    );
  else
    update public.ledger_entries
    set amount_cents = greatest(amount_cents - refund_row.amount_cents, 0),
        updated_at = now()
    where id = ledger_row.id;
  end if;
end;
$$;

create or replace function public.refresh_ledger_readiness()
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  delay_hours integer;
  delay_seconds integer;
begin
  select payout_delay_hours, payout_delay_seconds
  into delay_hours, delay_seconds
  from public.platform_settings
  where id = 1;

  update public.ledger_entries as entry
  set status = case
      when exists (
        select 1 from public.job_disputes
        where job_id = entry.job_id and payout_hold
      ) then 'held'
      when exists (
        select 1 from public.card_disputes
        where job_id = entry.job_id and outcome is null
      ) then 'held'
      when not exists (
        select 1 from public.driver_connect_accounts
        where driver_id = entry.driver_id and payouts_enabled
      ) then 'held_until_onboarding'
      when entry.available_on is not null
        and entry.available_on <= now()
        and entry.amount_cents > 0
        and (
          entry.entry_kind = 'tip'
          or exists (
            select 1 from public.jobs
            where jobs.id = entry.job_id
              and jobs.updated_at <= now() - case
                when public.driver_completed_jobs(entry.driver_id) < 5 then interval '48 hours'
                when delay_seconds is not null then make_interval(secs => delay_seconds)
                else make_interval(hours => delay_hours)
              end
              and (
                jobs.status = 'completed'
                or (jobs.status = 'cancelled' and jobs.payment_status = 'captured')
              )
          )
        ) then 'ready'
      else 'pending'
    end,
    hold_reason = case
      when exists (
        select 1 from public.job_disputes
        where job_id = entry.job_id and payout_hold
      ) then 'A problem report is open'
      when exists (
        select 1 from public.card_disputes
        where job_id = entry.job_id and outcome is null
      ) then 'A card dispute is open'
      when not exists (
        select 1 from public.driver_connect_accounts
        where driver_id = entry.driver_id and payouts_enabled
      ) then 'Finish payout setup before a transfer can be sent'
      when entry.available_on is null then 'Waiting for the card payment to become available'
      when entry.entry_kind is distinct from 'tip'
        and public.driver_completed_jobs(entry.driver_id) < 5
        and exists (
          select 1 from public.jobs
          where jobs.id = entry.job_id
            and jobs.updated_at > now() - interval '48 hours'
        ) then 'Earnings stay held for 48 hours after a new driver finishes a job'
      else null
    end,
    updated_at = now()
  where entry.status in ('pending', 'held', 'held_until_onboarding', 'ready')
    and entry.stripe_transfer_id is null
    and entry.external_method is null;
end;
$function$;

create or replace function public.ready_transfers()
returns table (
  entry_id uuid,
  amount_cents integer,
  driver_id uuid,
  stripe_account_id text,
  charge_id text
)
language sql
security definer
set search_path = public
as $$
  select
    ledger_entries.id,
    ledger_entries.amount_cents,
    ledger_entries.driver_id,
    driver_connect_accounts.stripe_account_id,
    coalesce(job_tips.stripe_charge_id, job_payments.charge_id)
  from public.ledger_entries
  join public.jobs on jobs.id = ledger_entries.job_id
  join public.driver_connect_accounts
    on driver_connect_accounts.driver_id = ledger_entries.driver_id
    and driver_connect_accounts.payouts_enabled
  left join public.job_payments on job_payments.job_id = ledger_entries.job_id
  left join public.job_tips on job_tips.id = ledger_entries.tip_id
  where ledger_entries.status = 'ready'
    and ledger_entries.amount_cents > 0
    and ledger_entries.stripe_transfer_id is null
    and jobs.is_test = false
    and coalesce(job_payments.stripe_livemode, false) = false
    and (
      (ledger_entries.entry_kind = 'base' and job_payments.charge_id is not null)
      or (ledger_entries.entry_kind = 'tip' and job_tips.status = 'succeeded' and job_tips.stripe_charge_id is not null)
    )
    and not exists (
      select 1 from public.job_disputes
      where job_id = ledger_entries.job_id and payout_hold
    )
    and not exists (
      select 1 from public.card_disputes
      where job_id = ledger_entries.job_id and outcome is null
    );
$$;

create or replace function public.post_driver_earnings(target_job uuid, available_on timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  amount integer;
  next_status text;
  reason text;
  payouts_on boolean;
begin
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.payment_status is distinct from 'captured' or job_row.assigned_driver_id is null then
    return;
  end if;
  if coalesce(job_row.late_cancel_cents, 0) > 0 then
    amount := coalesce(job_row.fee_driver_cents, 0);
  elsif job_row.status = 'cancelled' and coalesce(job_row.trip_fee_cents, 0) > 0 then
    amount := least(2000, job_row.trip_fee_cents);
  elsif job_row.status = 'completed' then
    amount := job_row.driver_pay_cents;
  else
    return;
  end if;
  if amount is null or amount <= 0 then
    return;
  end if;

  select coalesce(payouts_enabled, false) into payouts_on
  from public.driver_connect_accounts
  where driver_id = job_row.assigned_driver_id;

  if exists (select 1 from public.job_disputes where job_id = target_job and payout_hold) then
    next_status := 'held';
    reason := 'A problem report is open';
  elsif not coalesce(payouts_on, false) then
    next_status := 'held_until_onboarding';
    reason := 'Finish payout setup before a transfer can be sent';
  else
    next_status := 'pending';
    reason := 'Waiting for the payout delay and for the card payment to become available';
  end if;

  insert into public.ledger_entries (
    job_id, driver_id, amount_cents, status, hold_reason, available_on, entry_kind
  ) values (
    target_job, job_row.assigned_driver_id, amount, next_status, reason, available_on, 'base'
  )
  on conflict (job_id) where entry_kind = 'base' do update
    set amount_cents = excluded.amount_cents,
        updated_at = now()
    where public.ledger_entries.amount_cents is distinct from excluded.amount_cents
      and public.ledger_entries.entry_kind = 'base';
end;
$function$;

revoke all on function public.record_card_consent() from public, anon, authenticated, service_role;
revoke all on function public.revoke_card_consent() from public, anon, authenticated, service_role;
revoke all on function public.save_payment_method(uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.detach_payment_method(text) from public, anon, authenticated, service_role;
revoke all on function public.begin_tip(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.note_tip_intent(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.confirm_tip_payment(uuid, text, text, integer, boolean) from public, anon, authenticated, service_role;
revoke all on function public.fail_tip(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.begin_tip_refund(uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.apply_tip_refund(uuid, text, boolean) from public, anon, authenticated, service_role;

grant execute on function public.record_card_consent() to authenticated;
grant execute on function public.revoke_card_consent() to authenticated;
grant execute on function public.save_payment_method(uuid, text, text, text, text) to service_role;
grant execute on function public.detach_payment_method(text) to authenticated;
grant execute on function public.begin_tip(uuid, integer) to authenticated;
grant execute on function public.note_tip_intent(uuid, text, text) to service_role;
grant execute on function public.confirm_tip_payment(uuid, text, text, integer, boolean) to service_role;
grant execute on function public.fail_tip(uuid, text) to service_role;
grant execute on function public.begin_tip_refund(uuid, integer, text) to authenticated;
grant execute on function public.apply_tip_refund(uuid, text, boolean) to service_role;
