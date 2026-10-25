-- Local until approved. Synthetic admins cannot read real private job rows.
-- A Get a quote request stays off the driver feed until the customer accepts the admin price.
-- A stored commission label follows the saved cents. Real financial rows are not rewritten.

begin;

drop policy if exists job_private_select_parties on public.job_private;
create policy job_private_select_parties on public.job_private
  for select to authenticated
  using (
    (
      public.is_admin()
      and public.test_lane_matches(public.job_is_test(job_id))
    )
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
    (
      public.is_admin()
      and public.test_lane_matches(public.job_is_test(job_id))
    )
    or exists (
      select 1 from public.jobs
      where jobs.id = job_private.job_id
        and jobs.customer_id = auth.uid()
    )
  );

drop policy if exists job_private_admin_update on public.job_private;
create policy job_private_admin_update on public.job_private
  for update to authenticated
  using (
    public.is_admin()
    and public.test_lane_matches(public.job_is_test(job_id))
  )
  with check (
    public.is_admin()
    and public.test_lane_matches(public.job_is_test(job_id))
  );

drop policy if exists job_photos_select_parties on public.job_photos;
create policy job_photos_select_parties on public.job_photos
  for select to authenticated
  using (
    (
      public.is_admin()
      and public.test_lane_matches(public.job_is_test(job_id))
    )
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
    (
      public.is_admin()
      and public.test_lane_matches(public.job_is_test(job_id))
    )
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
  using (
    bucket_id = 'job-photos'
    and public.is_admin()
    and public.test_lane_matches(public.job_is_test(public.storage_job_id(name)))
  );
create policy job_photos_storage_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-photos'
    and public.is_admin()
    and public.test_lane_matches(public.job_is_test(public.storage_job_id(name)))
  );
create policy job_photos_storage_admin_all
  on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'job-photos'
    and public.is_admin()
    and public.test_lane_matches(public.job_is_test(public.storage_job_id(name)))
  )
  with check (
    bucket_id = 'job-photos'
    and public.is_admin()
    and public.test_lane_matches(public.job_is_test(public.storage_job_id(name)))
  );

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
    or (
      driver_pay is not null
      and (quote_expires is null or quote_expires > now())
    );
$$;

revoke all on function public.quote_visible_to_drivers(public.pricing_method, integer, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.quote_visible_to_drivers(public.pricing_method, integer, timestamptz) to authenticated;

create or replace function public.driver_is_eligible_for_job(target_job uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  profile_row public.profiles%rowtype;
  driver_row public.drivers%rowtype;
  job_row public.jobs%rowtype;
begin
  if uid is null or public.account_is_suspended(uid) then
    return false;
  end if;
  select * into profile_row from public.profiles where id = uid;
  if not found or profile_row.blocked or profile_row.deleted_at is not null then
    return false;
  end if;
  if public.phone_is_restricted(profile_row.phone) then
    return false;
  end if;
  select * into driver_row from public.drivers where profile_id = uid;
  if not found or driver_row.status not in ('active', 'approved_new') or driver_row.driving_stopped_at is not null then
    return false;
  end if;
  select * into job_row from public.jobs where id = target_job;
  if not found or job_row.status <> 'open' or job_row.test_retired_at is not null then
    return false;
  end if;
  if not public.quote_visible_to_drivers(job_row.pricing_method, job_row.driver_pay_cents, job_row.quote_expires_at) then
    return false;
  end if;
  if job_row.is_test is distinct from profile_row.is_test then
    return false;
  end if;
  if job_row.customer_id = uid or public.account_is_suspended(job_row.customer_id) then
    return false;
  end if;
  if job_row.paused_at is not null and not (
    job_row.suspension_hold and not public.account_is_suspended(job_row.customer_id)
  ) then
    return false;
  end if;
  if job_row.required_vehicle is not null and not exists (
    select 1 from public.vehicles
    where driver_id = uid and type = job_row.required_vehicle
  ) then
    return false;
  end if;
  if exists (
    select 1 from public.customer_driver_blocks
    where customer_id = job_row.customer_id and driver_id = uid
  ) then
    return false;
  end if;
  if public.waves_enabled() and not public.job_released_to_driver(uid, job_row) then
    return false;
  end if;
  return true;
end;
$$;

do $$
declare
  src text;
  next text;
  quote_filter constant text := 'where j.status = ''open'' and public.quote_visible_to_drivers(j.pricing_method, j.driver_pay_cents, j.quote_expires_at)';
begin
  src := replace(pg_get_functiondef('public.driver_job_feed()'::regprocedure), chr(13), '');
  next := replace(src, 'where j.status = ''open''', quote_filter);
  if next = src then
    raise exception 'driver_job_feed quote filter was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.driver_browse_jobs()'::regprocedure), chr(13), '');
  next := replace(src, 'where j.status = ''open''', quote_filter);
  if next = src then
    raise exception 'driver_browse_jobs quote filter was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.create_customer_request(uuid, jsonb)'::regprocedure), chr(13), '');
  next := replace(
    src,
    'and j.status = ''open''',
    'and j.status = case when pricing_value = ''quote'' then ''requested''::public.job_status else ''open''::public.job_status end'
  );
  if next = src then
    raise exception 'create_customer_request status check was not found';
  end if;
  next := replace(
    next,
    'uid, service_value, ''open'', zone_value',
    'uid, service_value, case when pricing_value = ''quote'' then ''requested''::public.job_status else ''open''::public.job_status end, zone_value'
  );
  if position('then ''requested''::public.job_status else ''open''::public.job_status end, zone_value' in next) = 0 then
    raise exception 'create_customer_request insert status was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.submit_offer(uuid, text, integer, text)'::regprocedure), chr(13), '');
  next := replace(
    src,
    E'if job_row.pricing_method = ''quote'' then\n    breakdown := public.price_breakdown(''forward'', earnings_cents);\n    offer_kind := ''offer'';\n  elsif',
    E'if job_row.pricing_method = ''quote'' then\n    raise exception ''a quote is claimed after the customer accepts it'';\n  elsif'
  );
  if next = src then
    raise exception 'submit_offer quote branch was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.guard_job_offers()'::regprocedure), chr(13), '');
  next := replace(
    src,
    'if job_row.pricing_method = ''quote'' and not priced then',
    'if job_row.pricing_method = ''quote'' and not coalesce(public.is_migration_session(), false) then'
  );
  if next = src then
    raise exception 'guard_job_offers quote check was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.claim_job(uuid)'::regprocedure), chr(13), '');
  next := replace(
    src,
    E'if job_row.driver_pay_cents is null then\n    raise exception ''send an offer instead'';\n  end if;',
    E'if job_row.driver_pay_cents is null then\n    raise exception ''this quote is not ready for drivers'';\n  end if;\n  if job_row.quote_expires_at is not null and job_row.quote_expires_at <= now() then\n    raise exception ''this quote has expired'';\n  end if;'
  );
  if next = src then
    raise exception 'claim_job quote check was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.notify_drivers_of_open_job(public.jobs)'::regprocedure), chr(13), '');
  next := replace(
    src,
    E'begin\n  if job_row.test_retired_at is not null then',
    E'begin\n  if not public.quote_visible_to_drivers(job_row.pricing_method, job_row.driver_pay_cents, job_row.quote_expires_at) then\n    return;\n  end if;\n  if job_row.test_retired_at is not null then'
  );
  if next = src then
    raise exception 'open job notification quote check was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.answer_detail_request(uuid, jsonb, text)'::regprocedure), chr(13), '');
  next := replace(
    src,
    E'set\n    status = ''open'',',
    E'set\n    status = case when pricing_method = ''quote'' and status is distinct from ''open'' then ''requested''::public.job_status else ''open''::public.job_status end,'
  );
  if next = src then
    raise exception 'answer_detail_request quote status was not found';
  end if;
  execute next;

  src := replace(pg_get_functiondef('public.messages_return_detail_request()'::regprocedure), chr(13), '');
  next := replace(
    src,
    E'set\n    status = ''open'',',
    E'set\n    status = case when pricing_method = ''quote'' and status is distinct from ''open'' then ''requested''::public.job_status else ''open''::public.job_status end,'
  );
  if next = src then
    raise exception 'messages_return_detail_request quote status was not found';
  end if;
  execute next;
end $$;

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
  base integer;
begin
  if tg_op = 'UPDATE'
    and old.commission_bps is null
    and old.platform_fee_cents is null
    and new.platform_fee_cents is not null
    and new.commission_bps is null
    and coalesce(public.can_set_quote_prices(), false)
    and coalesce(current_setting('pickuply.offer_chosen', true), '') is distinct from 'yes'
    and coalesce(current_setting('pickuply.job_claimed', true), '') is distinct from 'yes' then
    base := coalesce(new.driver_pay_cents, 0) + coalesce(new.platform_fee_cents, 0);
    if base > 0 then
      new.commission_bps := public.round_half_up(new.platform_fee_cents::bigint * 10000, base::bigint);
    end if;
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
    or value ~ '(^|[^0-9])[0-9]{10}([^0-9]|$)'
    or value ~ '(^|[^0-9])[0-9]{3}[-. ][0-9]{4}([^0-9]|$)';
$$;

-- Synthetic rows only. A label that does not match the stored fee is corrected.
-- Real jobs, including rows with no commission rate, are left as they are.
update public.jobs
set commission_bps = public.round_half_up(
  platform_fee_cents::bigint * 10000,
  (driver_pay_cents + platform_fee_cents)::bigint
)
where is_test
  and driver_pay_cents is not null
  and platform_fee_cents is not null
  and driver_pay_cents + platform_fee_cents > 0
  and commission_bps is distinct from public.round_half_up(
    platform_fee_cents::bigint * 10000,
    (driver_pay_cents + platform_fee_cents)::bigint
  );

commit;
