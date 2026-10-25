-- Rollback for 0076_uat_fixes.sql. Tested locally inside a transaction that was rolled back.
-- Do not run this on the hosted project unless the owner approves a recovery.
--
-- This restores the policies and functions from before 0076.
-- Restoring those policies lets a synthetic admin read real private job rows and real job photo files.
-- Reverting the Vercel deployment does not close that hole. Keep the 0076 policies unless a replacement policy is applied in the same recovery.
-- This file does not change commission_bps. The 0076 correction only relabeled is_test rows, and the previous labels were not saved.

drop policy if exists job_private_select_parties on public.job_private;
create policy job_private_select_parties on public.job_private
  for select to authenticated
  using (
    public.is_admin()
    or public.is_assigned_driver(job_id)
    or exists (
      select 1 from public.jobs
      where jobs.id = job_private.job_id
        and jobs.customer_id = auth.uid()
    )
  );

drop policy if exists job_private_insert_owner on public.job_private;
create policy job_private_insert_owner on public.job_private
  for insert to authenticated
  with check (
    public.is_admin()
    or exists (
      select 1 from public.jobs
      where jobs.id = job_private.job_id
        and jobs.customer_id = auth.uid()
    )
  );

drop policy if exists job_private_admin_update on public.job_private;
create policy job_private_admin_update on public.job_private
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists job_photos_select_parties on public.job_photos;
create policy job_photos_select_parties on public.job_photos
  for select to authenticated
  using (
    public.is_admin()
    or public.is_assigned_driver(job_id)
    or exists (
      select 1 from public.jobs
      where jobs.id = job_photos.job_id
        and jobs.customer_id = auth.uid()
    )
  );

drop policy if exists job_photos_insert_parties on public.job_photos;
create policy job_photos_insert_parties on public.job_photos
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      exists (
        select 1 from public.jobs
        where jobs.id = job_photos.job_id
          and jobs.customer_id = auth.uid()
      )
      and stage in ('request', 'report')
    )
    or (
      public.is_assigned_driver(job_id)
      and stage in ('pickup', 'dropoff', 'dump_receipt')
    )
  );

drop policy if exists job_photos_storage_admin_all on storage.objects;
drop policy if exists job_photos_storage_admin_read on storage.objects;
drop policy if exists job_photos_storage_admin_insert on storage.objects;
create policy job_photos_storage_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'job-photos' and public.is_admin());
create policy job_photos_storage_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'job-photos' and public.is_admin());

create or replace function public.guard_job_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed boolean := coalesce(public.can_set_quote_prices(), false)
    or coalesce(public.is_migration_session(), false)
    or coalesce(current_setting('pickuply.offer_chosen', true), '') = 'yes'
    or coalesce(current_setting('pickuply.job_claimed', true), '') = 'yes';
begin
  if tg_op = 'UPDATE'
    and old.commission_bps is null
    and old.platform_fee_cents is null
    and new.platform_fee_cents is not null
    and new.commission_bps is null
    and coalesce(public.can_set_quote_prices(), false)
    and coalesce(current_setting('pickuply.offer_chosen', true), '') is distinct from 'yes'
    and coalesce(current_setting('pickuply.job_claimed', true), '') is distinct from 'yes' then
    new.commission_bps := (select platform_bps from public.platform_settings where id = 1);
  end if;
  if new.commission_bps is distinct from (case when tg_op = 'UPDATE' then old.commission_bps else null end)
    and not allowed then
    raise exception 'only an admin can change quote prices';
  end if;
  return new;
end;
$$;

create or replace function public.contains_contact(value text)
returns boolean
language sql
immutable
as $$
  select value ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
    or value ~ '\+1[0-9]{10}'
    or value ~ '[0-9]{3}[^0-9][0-9]{3}[^0-9][0-9]{4}'
    or value ~ '(^|[^0-9])[0-9]{10}([^0-9]|$)';
$$;

do $$
declare
  src text;
  next text;
  quote_filter constant text := 'where j.status = ''open'' and public.quote_visible_to_drivers(j.pricing_method, j.driver_pay_cents, j.quote_expires_at)';
begin
  src := replace(pg_get_functiondef('public.driver_is_eligible_for_job(uuid)'::regprocedure), chr(13), '');
  next := replace(
    src,
    E'  if not public.quote_visible_to_drivers(job_row.pricing_method, job_row.driver_pay_cents, job_row.quote_expires_at) then\n    return false;\n  end if;\n',
    ''
  );
  if next = src then
    raise exception 'driver eligibility quote check was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.driver_job_feed()'::regprocedure), chr(13), '');
  next := replace(src, quote_filter, 'where j.status = ''open''');
  if next = src then
    raise exception 'driver feed quote filter was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.driver_browse_jobs()'::regprocedure), chr(13), '');
  next := replace(src, quote_filter, 'where j.status = ''open''');
  if next = src then
    raise exception 'driver browse quote filter was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.create_customer_request(uuid, jsonb)'::regprocedure), chr(13), '');
  next := replace(
    src,
    'and j.status = case when pricing_value = ''quote'' then ''requested''::public.job_status else ''open''::public.job_status end',
    'and j.status = ''open'''
  );
  if next = src then
    raise exception 'request status check was not found';
  end if;
  next := replace(
    next,
    'uid, service_value, case when pricing_value = ''quote'' then ''requested''::public.job_status else ''open''::public.job_status end, zone_value',
    'uid, service_value, ''open'', zone_value'
  );
  if position('uid, service_value, ''open'', zone_value' in next) = 0 then
    raise exception 'request insert status was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.submit_offer(uuid, text, integer, text)'::regprocedure), chr(13), '');
  next := replace(
    src,
    E'if job_row.pricing_method = ''quote'' then\n    raise exception ''a quote is claimed after the customer accepts it'';\n  elsif',
    E'if job_row.pricing_method = ''quote'' then\n    breakdown := public.price_breakdown(''forward'', earnings_cents);\n    offer_kind := ''offer'';\n  elsif'
  );
  if next = src then
    raise exception 'submit offer quote branch was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.guard_job_offers()'::regprocedure), chr(13), '');
  next := replace(
    src,
    'if job_row.pricing_method = ''quote'' and not coalesce(public.is_migration_session(), false) then',
    'if job_row.pricing_method = ''quote'' and not priced then'
  );
  if next = src then
    raise exception 'offer guard quote check was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.claim_job(uuid)'::regprocedure), chr(13), '');
  next := replace(
    src,
    E'if job_row.driver_pay_cents is null then\n    raise exception ''this quote is not ready for drivers'';\n  end if;\n  if job_row.quote_expires_at is not null and job_row.quote_expires_at <= now() then\n    raise exception ''this quote has expired'';\n  end if;',
    E'if job_row.driver_pay_cents is null then\n    raise exception ''send an offer instead'';\n  end if;'
  );
  if next = src then
    raise exception 'claim quote check was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.notify_drivers_of_open_job(public.jobs)'::regprocedure), chr(13), '');
  next := replace(
    src,
    E'begin\n  if not public.quote_visible_to_drivers(job_row.pricing_method, job_row.driver_pay_cents, job_row.quote_expires_at) then\n    return;\n  end if;\n  if job_row.test_retired_at is not null then',
    E'begin\n  if job_row.test_retired_at is not null then'
  );
  if next = src then
    raise exception 'notification quote check was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.answer_detail_request(uuid, jsonb, text)'::regprocedure), chr(13), '');
  next := replace(
    src,
    E'set\n    status = case when pricing_method = ''quote'' and status is distinct from ''open'' then ''requested''::public.job_status else ''open''::public.job_status end,',
    E'set\n    status = ''open'','
  );
  if next = src then
    raise exception 'detail answer quote status was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.messages_return_detail_request()'::regprocedure), chr(13), '');
  next := replace(
    src,
    E'set\n    status = case when pricing_method = ''quote'' and status is distinct from ''open'' then ''requested''::public.job_status else ''open''::public.job_status end,',
    E'set\n    status = ''open'','
  );
  if next = src then
    raise exception 'message detail quote status was not found';
  end if;
  execute next;
end $$;

drop function public.quote_visible_to_drivers(public.pricing_method, integer, timestamptz);
