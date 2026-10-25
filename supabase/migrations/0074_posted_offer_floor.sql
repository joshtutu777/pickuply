-- Posted customer prices have to meet the service minimum.
-- 0073 already contains these guards for a fresh database. This migration
-- installs them where 0073 was applied before those guards were in that file.
-- Stored price, earnings, commission, and processing cents are not rewritten.

create or replace function public.price_breakdown(mode text, amount_cents integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  settings public.platform_settings%rowtype;
  earnings integer;
  platform integer;
  total integer;
begin
  if mode not in ('forward', 'accept') then
    raise exception 'unknown price mode';
  end if;
  if amount_cents is null or amount_cents <= 0 then
    raise exception 'offer amount must be a positive number of cents';
  end if;
  select * into settings from public.platform_settings where id = 1;
  earnings := public.round_half_up(amount_cents::bigint * (10000 - settings.platform_bps), 10000);
  if earnings <= 0 then
    raise exception 'driver earnings would be zero';
  end if;
  platform := amount_cents - earnings;
  total := public.smallest_covered_total(amount_cents, settings.service_bps, settings.service_fixed_cents);
  if total < amount_cents then
    raise exception 'card processing cannot be taken from the offer';
  end if;
  return jsonb_build_object(
    'driver_earnings_cents', earnings,
    'platform_fee_cents', platform,
    'subtotal_cents', amount_cents,
    'service_fee_cents', total - amount_cents,
    'customer_total_cents', total,
    'commission_bps', settings.platform_bps,
    'offer_cents', amount_cents
  );
end;
$$;

create or replace function public.guard_posted_offer_floor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  floor_cents integer;
begin
  if coalesce(public.is_migration_session(), false) then
    return new;
  end if;
  floor_cents := public.offer_minimum_cents(new.service);
  if new.pricing_method = 'fixed'
    and new.offer_cents is not null
    and new.offer_cents < floor_cents then
    raise exception 'offer amount is below the minimum' using errcode = '23514';
  end if;
  if new.pricing_method = 'range'
    and new.budget_min_cents is not null
    and new.budget_min_cents < floor_cents then
    raise exception 'offer amount is below the minimum' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_posted_offer_floor on public.jobs;
create trigger jobs_posted_offer_floor
  before insert on public.jobs
  for each row execute function public.guard_posted_offer_floor();
