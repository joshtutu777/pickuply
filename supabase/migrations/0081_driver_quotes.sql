-- A posted Get a quote request is visible to drivers. Each driver can send a quote.
-- The customer chooses one. An accepted admin price is still claimed, not re-priced.

begin;

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

create or replace function public.note_job_feed_signal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.test_retired_at is null
      and new.paused_at is null
      and (
        new.status = 'open'
        or (new.pricing_method = 'quote' and new.status in ('requested', 'quoted'))
      ) then
      delete from public.job_feed_signals where created_at < now() - interval '1 day';
      insert into public.job_feed_signals (is_test) values (new.is_test);
    end if;
  elsif new.status is distinct from old.status or new.paused_at is distinct from old.paused_at then
    if (new.status = 'open' or old.status = 'open') and new.test_retired_at is null then
      delete from public.job_feed_signals where created_at < now() - interval '1 day';
      insert into public.job_feed_signals (is_test) values (new.is_test);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.note_job_feed_signal() from public, anon, authenticated, service_role;

do $quote$
declare
  src text;
  next text;
  old_filter constant text := 'where j.status = ''open'' and public.quote_visible_to_drivers(j.pricing_method, j.driver_pay_cents, j.quote_expires_at)';
  new_filter constant text := 'where (j.status = ''open'' or (j.pricing_method = ''quote'' and j.status in (''requested'', ''quoted''))) and public.quote_visible_to_drivers(j.pricing_method, j.driver_pay_cents, j.quote_expires_at)';
  fn text;
begin
  src := replace(pg_get_functiondef('public.driver_is_eligible_for_job(uuid)'::regprocedure), chr(13), '');
  next := replace(
    src,
    E'  if not found or job_row.status <> ''open'' or job_row.test_retired_at is not null then\n    return false;\n  end if;',
    E'  if not found or job_row.test_retired_at is not null then\n    return false;\n  end if;\n  if job_row.status <> ''open''\n    and not (job_row.pricing_method = ''quote'' and job_row.status in (''requested'', ''quoted'')) then\n    return false;\n  end if;'
  );
  if next = src then
    raise exception 'driver_is_eligible_for_job quote status check was not found';
  end if;
  execute next;

  foreach fn in array array['public.driver_job_feed()', 'public.driver_browse_jobs()']
  loop
    src := replace(pg_get_functiondef(fn::regprocedure), chr(13), '');
    next := replace(src, old_filter, new_filter);
    if next = src then
      raise exception '% quote feed filter was not found', fn;
    end if;
    execute next;
  end loop;

  src := replace(pg_get_functiondef('public.submit_offer(uuid, text, integer, text)'::regprocedure), chr(13), '');
  next := replace(
    src,
    E'  if not found or job_row.status <> ''open'' then\n    raise exception ''offers are only allowed on open jobs'';\n  end if;',
    E'  if not found or (\n    job_row.status <> ''open''\n    and not (job_row.pricing_method = ''quote'' and job_row.status in (''requested'', ''quoted''))\n  ) then\n    raise exception ''offers are only allowed on open jobs'';\n  end if;'
  );
  if next = src then
    raise exception 'submit_offer status check was not found';
  end if;
  src := next;
  next := replace(
    src,
    E'if job_row.pricing_method = ''quote'' then\n    raise exception ''a quote is claimed after the customer accepts it'';\n  elsif',
    E'if job_row.pricing_method = ''quote'' and job_row.status = ''open'' and job_row.driver_pay_cents is not null then\n    raise exception ''a quote is claimed after the customer accepts it'';\n  elsif job_row.pricing_method = ''quote'' then\n    breakdown := public.price_breakdown(''forward'', earnings_cents);\n    offer_kind := ''offer'';\n  elsif'
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
  src := next;
  next := replace(
    src,
    E'    if job_row.status <> ''open'' then\n      raise exception ''offers are only allowed on open jobs'';\n    end if;',
    E'    if job_row.status <> ''open''\n      and not (job_row.pricing_method = ''quote'' and job_row.status in (''requested'', ''quoted'')) then\n      raise exception ''offers are only allowed on open jobs'';\n    end if;'
  );
  if next = src then
    raise exception 'guard_job_offers status check was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.choose_offer(uuid)'::regprocedure), chr(13), '');
  next := replace(
    src,
    E'  if not found or job_row.status <> ''open'' then\n    raise exception ''job already taken'';\n  end if;',
    E'  if not found or (\n    job_row.status <> ''open''\n    and not (job_row.pricing_method = ''quote'' and job_row.status in (''requested'', ''quoted''))\n  ) then\n    raise exception ''job already taken'';\n  end if;'
  );
  if next = src then
    raise exception 'choose_offer status check was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.guard_jobs()'::regprocedure), chr(13), '');
  next := replace(
    src,
    E'    if new.status = ''assigned''\n      and old.status is distinct from ''open''\n      and old.status is distinct from ''assigned'' then\n      raise exception ''assignment only follows an open job'';\n    end if;',
    E'    if new.status = ''assigned''\n      and old.status is distinct from ''open''\n      and old.status is distinct from ''assigned''\n      and not (\n        booking_step\n        and old.pricing_method = ''quote''\n        and old.status in (''requested'', ''quoted'')\n      ) then\n      raise exception ''assignment only follows an open job'';\n    end if;'
  );
  if next = src then
    raise exception 'guard_jobs assignment check was not found';
  end if;
  execute next;
end
$quote$;

commit;
