-- A signed tip refund can arrive before its local refund row is committed.
-- Keep that Stripe refund until the row exists, then apply it once.
-- Do not apply this file to the hosted project until the owner approves it.

create table public.deferred_tip_refunds (
  stripe_refund_id text primary key,
  tip_refund_id uuid not null,
  amount_cents integer not null check (amount_cents > 0),
  succeeded boolean not null,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  constraint deferred_tip_refunds_id_shape check (stripe_refund_id ~ '^re_[A-Za-z0-9]+$')
);

alter table public.deferred_tip_refunds enable row level security;

create policy deferred_tip_refunds_admin_read on public.deferred_tip_refunds
  for select to authenticated
  using (public.is_admin());

grant select on public.deferred_tip_refunds to authenticated;

create or replace function public.reconcile_deferred_tip_refund(target_refund uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  waiting public.deferred_tip_refunds%rowtype;
  refund_row public.tip_refunds%rowtype;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  if target_refund is null then
    return 'missing';
  end if;
  select * into waiting
  from public.deferred_tip_refunds
  where tip_refund_id = target_refund and applied_at is null
  order by created_at
  limit 1
  for update;
  if not found then
    return 'none';
  end if;
  select * into refund_row from public.tip_refunds where id = target_refund for update;
  if not found then
    return 'deferred';
  end if;
  if refund_row.amount_cents is distinct from waiting.amount_cents then
    return 'mismatch';
  end if;
  perform public.apply_tip_refund(target_refund, waiting.stripe_refund_id, waiting.succeeded);
  select * into refund_row from public.tip_refunds where id = target_refund;
  if refund_row.stripe_refund_id is distinct from waiting.stripe_refund_id then
    return 'deferred';
  end if;
  if waiting.succeeded and refund_row.status is distinct from 'succeeded' then
    return 'deferred';
  end if;
  if not waiting.succeeded and refund_row.status is distinct from 'failed' then
    return 'deferred';
  end if;
  update public.deferred_tip_refunds
  set applied_at = now()
  where stripe_refund_id = waiting.stripe_refund_id and applied_at is null;
  return 'applied';
end;
$$;

create or replace function public.defer_tip_refund(
  target_refund uuid,
  stripe_refund_id text,
  amount_cents integer,
  succeeded boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.deferred_tip_refunds%rowtype;
  outcome text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  if target_refund is null or stripe_refund_id is null or stripe_refund_id !~ '^re_[A-Za-z0-9]+$' then
    raise exception 'refund id is not valid';
  end if;
  if amount_cents is null or amount_cents <= 0 then
    raise exception 'refund amount is missing';
  end if;
  insert into public.deferred_tip_refunds (stripe_refund_id, tip_refund_id, amount_cents, succeeded)
  values (
    defer_tip_refund.stripe_refund_id,
    defer_tip_refund.target_refund,
    defer_tip_refund.amount_cents,
    coalesce(defer_tip_refund.succeeded, false)
  )
  on conflict on constraint deferred_tip_refunds_pkey do nothing;
  select * into existing from public.deferred_tip_refunds where deferred_tip_refunds.stripe_refund_id = defer_tip_refund.stripe_refund_id for update;
  if existing.tip_refund_id is distinct from defer_tip_refund.target_refund
     or existing.amount_cents is distinct from defer_tip_refund.amount_cents then
    raise exception 'this Stripe refund is already recorded for another tip';
  end if;
  if existing.applied_at is not null then
    return 'duplicate';
  end if;
  outcome := public.reconcile_deferred_tip_refund(target_refund);
  if outcome = 'applied' then
    return 'applied';
  end if;
  return outcome;
end;
$$;

create or replace function public.reconcile_tip_refund_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_role text;
  previous_claims text;
begin
  previous_role := current_setting('request.jwt.claim.role', true);
  previous_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform public.reconcile_deferred_tip_refund(new.id);
  perform set_config('request.jwt.claim.role', coalesce(previous_role, ''), true);
  perform set_config('request.jwt.claims', coalesce(previous_claims, '{}'), true);
  return new;
end;
$$;

create trigger tip_refunds_reconcile_deferred
  after insert on public.tip_refunds
  for each row
  execute function public.reconcile_tip_refund_after_insert();

revoke all on function public.reconcile_tip_refund_after_insert() from public, anon, authenticated, service_role;
revoke all on function public.reconcile_deferred_tip_refund(uuid) from public, anon, authenticated, service_role;
revoke all on function public.defer_tip_refund(uuid, text, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.reconcile_deferred_tip_refund(uuid) to service_role;
grant execute on function public.defer_tip_refund(uuid, text, integer, boolean) to service_role;
