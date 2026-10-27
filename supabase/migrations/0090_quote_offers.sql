-- A Get a quote request opens immediately. Eligible drivers send competing offers.
-- An optional admin price still hides that priced job until the customer accepts it, then a driver claims it.
-- This file does not update existing job rows.

create or replace function public.quote_visible_to_drivers(
  method public.pricing_method,
  driver_pay integer,
  quote_expires timestamptz
)
returns boolean
language sql
stable
as $$
  select method is distinct from 'quote'
    or driver_pay is null
    or quote_expires is null
    or quote_expires > now();
$$;

revoke all on function public.quote_visible_to_drivers(public.pricing_method, integer, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.quote_visible_to_drivers(public.pricing_method, integer, timestamptz) to authenticated;

do $quote_offers$
declare
  src text;
  next text;
begin
  src := replace(pg_get_functiondef('public.create_customer_request(uuid, jsonb)'::regprocedure), chr(13), '');
  next := replace(
    src,
    'and j.status = case when pricing_value = ''quote'' then ''requested''::public.job_status else ''open''::public.job_status end',
    'and j.status = ''open''::public.job_status'
  );
  if next = src then
    raise exception 'create_customer_request quote retry status was not found';
  end if;
  src := next;
  next := replace(
    src,
    'uid, service_value, case when pricing_value = ''quote'' then ''requested''::public.job_status else ''open''::public.job_status end, zone_value',
    'uid, service_value, ''open''::public.job_status, zone_value'
  );
  if next = src then
    raise exception 'create_customer_request quote insert status was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.submit_offer(uuid, text, integer, text)'::regprocedure), chr(13), '');
  next := replace(
    src,
    E'if job_row.pricing_method = ''quote'' then\n    raise exception ''a quote is claimed after the customer accepts it'';\n  elsif',
    E'if job_row.pricing_method = ''quote'' and job_row.driver_pay_cents is not null then\n    raise exception ''a quote is claimed after the customer accepts it'';\n  elsif job_row.pricing_method = ''quote'' then\n    breakdown := public.price_breakdown(''forward'', earnings_cents);\n    offer_kind := ''offer'';\n  elsif'
  );
  if next = src then
    raise exception 'submit_offer quote branch was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.guard_job_offers()'::regprocedure), chr(13), '');
  next := replace(
    src,
    'if job_row.pricing_method = ''quote'' and not coalesce(public.is_migration_session(), false) then',
    'if job_row.pricing_method = ''quote'' and not priced then'
  );
  if next = src then
    raise exception 'guard_job_offers quote check was not found';
  end if;
  execute next;
end
$quote_offers$;
