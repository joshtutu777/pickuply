-- Stripe Connect Express accounts for drivers.
-- Stores the account id and Stripe's status only. No bank account, SSN, or ID number.
-- Do not apply this file to the hosted project until the owner approves it.

create table public.driver_connect_accounts (
  driver_id uuid primary key references public.drivers (profile_id) on delete cascade,
  stripe_account_id text not null unique,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  requirements_due text[] not null default '{}',
  disabled_reason text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  constraint driver_connect_accounts_id_shape check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$')
);

create table public.stripe_events (
  id text primary key,
  event_type text not null,
  account_id text,
  received_at timestamptz not null default now()
);

alter table public.driver_connect_accounts enable row level security;
alter table public.stripe_events enable row level security;

create policy driver_connect_select_own on public.driver_connect_accounts
  for select to authenticated
  using (driver_id = auth.uid() or public.is_admin());

grant select on public.driver_connect_accounts to authenticated;

create or replace function public.upsert_connect_account(
  target_driver uuid,
  account_id text,
  charges_enabled boolean,
  payouts_enabled boolean,
  details_submitted boolean,
  requirements_due text[],
  disabled_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_driver is null or account_id is null or account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception 'a Stripe account id is required';
  end if;
  if not exists (select 1 from public.drivers where profile_id = target_driver) then
    raise exception 'that person is not a driver';
  end if;

  insert into public.driver_connect_accounts (
    driver_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted,
    requirements_due, disabled_reason, synced_at
  ) values (
    target_driver, account_id, coalesce(charges_enabled, false), coalesce(payouts_enabled, false),
    coalesce(details_submitted, false), coalesce(requirements_due, '{}'), nullif(disabled_reason, ''), now()
  )
  on conflict (driver_id) do update
  set charges_enabled = excluded.charges_enabled,
      payouts_enabled = excluded.payouts_enabled,
      details_submitted = excluded.details_submitted,
      requirements_due = excluded.requirements_due,
      disabled_reason = excluded.disabled_reason,
      synced_at = now()
  where public.driver_connect_accounts.stripe_account_id = excluded.stripe_account_id;

  if not exists (
    select 1 from public.driver_connect_accounts
    where driver_id = target_driver and stripe_account_id = account_id
  ) then
    raise exception 'this driver already has a different payout account';
  end if;
end;
$$;

revoke all on function public.upsert_connect_account(uuid, text, boolean, boolean, boolean, text[], text)
  from public, anon, authenticated;
grant execute on function public.upsert_connect_account(uuid, text, boolean, boolean, boolean, text[], text)
  to service_role;

create or replace function public.claim_stripe_event(
  event_id text,
  event_type text,
  account_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_id text;
begin
  if coalesce(event_id, '') = '' then
    return false;
  end if;
  insert into public.stripe_events (id, event_type, account_id)
  values (event_id, left(coalesce(event_type, 'unknown'), 120), account_id)
  on conflict (id) do nothing
  returning id into inserted_id;
  return inserted_id is not null;
end;
$$;

revoke all on function public.claim_stripe_event(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_stripe_event(text, text, text) to service_role;

grant execute on function public.enqueue_notification(uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function public.notify_admins(uuid, text, text, text, text, text) to service_role;
