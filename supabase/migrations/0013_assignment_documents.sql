-- Assignment, document expiry, and payment changes stay on audited paths.
-- Do not apply this file to the hosted project until the owner approves.

create or replace function public.guard_drivers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_migration_session() then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if public.is_admin()
      and coalesce(current_setting('pickuply.driver_review', true), '') = 'yes' then
      null;
    elsif not public.is_admin()
      and coalesce(current_setting('pickuply.driver_application', true), '') = 'yes'
      and new.status = 'pending_review'
      and old.status in ('applied', 'pending_review', 'removed') then
      null;
    else
      raise exception 'only an admin can change driver status';
    end if;
  end if;

  if public.is_admin() then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.profile_id is distinct from auth.uid()
      or new.status not in ('applied', 'pending_review') then
      raise exception 'a driver application starts as pending review';
    end if;
  else
    if new.status not in ('applied', 'pending_review')
      and (
        new.service_level is distinct from old.service_level
        or new.zone_id is distinct from old.zone_id
        or new.services is distinct from old.services
        or new.license_expires is distinct from old.license_expires
        or new.insurance_expires is distinct from old.insurance_expires
      ) then
      raise exception 'only an admin can change driver approval fields';
    end if;
    if new.is_online is distinct from old.is_online
      and coalesce(current_setting('pickuply.driver_online', true), '') is distinct from 'yes' then
      raise exception 'use the online switch';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.guard_vehicles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.approved is distinct from old.approved then
    if not public.is_migration_session() then
      if not public.is_admin()
        or coalesce(current_setting('pickuply.vehicle_approval', true), '') <> 'yes' then
        raise exception 'only an admin can approve a vehicle';
      end if;
      insert into public.audit_log (actor_id, action, target_type, target_id, data)
      values (
        auth.uid(),
        'approve_vehicle',
        'vehicle',
        new.id,
        jsonb_build_object('driver_id', new.driver_id, 'approved', new.approved)
      );
    end if;
  end if;

  if public.is_admin() or public.is_migration_session() then
    return new;
  end if;
  if new.driver_id is distinct from auth.uid() then
    raise exception 'drivers can only manage their own vehicles';
  end if;
  if new.approved then
    raise exception 'only an admin can approve a vehicle';
  end if;
  if tg_op = 'UPDATE' and old.approved and not new.approved then
    raise exception 'only an admin can change vehicle approval';
  end if;
  return new;
end;
$$;

create or replace function public.review_driver(
  target_driver uuid,
  decision text,
  note text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  driver_row public.drivers%rowtype;
  next_status public.driver_status;
  next_role public.profile_role;
begin
  if not public.is_admin() then
    raise exception 'only an admin can review drivers';
  end if;
  if decision not in (
    'approve_new', 'approve_active', 'request_changes', 'decline', 'pause', 'remove'
  ) then
    raise exception 'choose a review decision';
  end if;
  if decision in ('request_changes', 'decline', 'pause', 'remove')
    and length(btrim(coalesce(note, ''))) < 3 then
    raise exception 'add a short note for the driver';
  end if;

  select * into driver_row from public.drivers where profile_id = target_driver for update;
  if not found then
    raise exception 'driver application not found';
  end if;

  if decision in ('approve_new', 'approve_active') then
    if driver_row.license_url is null or driver_row.license_expires is null then
      raise exception 'license is required before approval';
    end if;
    if not exists (select 1 from public.vehicles where driver_id = target_driver) then
      raise exception 'a vehicle is required before approval';
    end if;
  end if;

  next_role := case
    when decision in ('approve_new', 'approve_active') then 'driver'::public.profile_role
    when decision in ('decline', 'remove') then 'customer'::public.profile_role
    else null
  end;
  next_status := case decision
    when 'approve_new' then 'approved_new'::public.driver_status
    when 'approve_active' then 'active'::public.driver_status
    when 'request_changes' then 'pending_review'::public.driver_status
    when 'decline' then 'removed'::public.driver_status
    when 'pause' then 'paused'::public.driver_status
    else 'removed'::public.driver_status
  end;

  perform set_config('pickuply.driver_review', 'yes', true);
  update public.drivers
  set
    status = next_status,
    review_note = nullif(btrim(coalesce(note, '')), ''),
    is_online = false
  where profile_id = target_driver;

  if decision in ('approve_new', 'approve_active') then
    perform set_config('pickuply.vehicle_approval', 'yes', true);
    update public.vehicles set approved = true where driver_id = target_driver;
  end if;

  if next_role is not null then
    update public.profiles set role = next_role where id = target_driver;
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'review_driver',
    'driver',
    target_driver,
    jsonb_build_object('decision', decision, 'note', nullif(btrim(coalesce(note, '')), ''))
  );
end;
$function$;

create or replace function public.guard_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prices_allowed boolean := coalesce(public.can_set_quote_prices(), false)
    or coalesce(current_setting('pickuply.offer_chosen', true), '') = 'yes'
    or coalesce(current_setting('pickuply.job_claimed', true), '') = 'yes';
  booking_step boolean := coalesce(current_setting('pickuply.job_claimed', true), '') = 'yes'
    or coalesce(current_setting('pickuply.offer_chosen', true), '') = 'yes';
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not public.is_admin() and not public.is_migration_session() then
      if new.customer_id is distinct from auth.uid() then
        raise exception 'customers can only create their own jobs';
      end if;
      if new.status is distinct from 'requested' then
        raise exception 'new jobs start as requested';
      end if;
    end if;
  else
    if new.pricing_method is distinct from old.pricing_method
      or new.offer_cents is distinct from old.offer_cents
      or new.budget_min_cents is distinct from old.budget_min_cents
      or new.budget_max_cents is distinct from old.budget_max_cents then
      raise exception 'the customer pricing preference cannot be changed';
    end if;

    if old.pricing_method = 'quote'
      and old.status = 'quoted'
      and new.status = 'open'
      and current_setting('pickuply.quote_accepted', true) is distinct from 'yes' then
      raise exception 'a quote job is published only when the customer accepts it';
    end if;

    if new.status = 'assigned'
      and old.status is distinct from 'open'
      and old.status is distinct from 'assigned' then
      raise exception 'assignment only follows an open job';
    end if;

    if new.status in ('en_route', 'arrived', 'item_check', 'in_transit', 'delivered', 'completed')
      and new.status is distinct from old.status
      and coalesce(new.payment_status, '') not in ('authorized', 'paid', 'captured') then
      raise exception 'payment must be authorized before work starts';
    end if;

    if new.assigned_driver_id is distinct from old.assigned_driver_id
      and not (
        coalesce(public.is_migration_session(), false)
        or booking_step
        or (
          coalesce(public.is_admin(), false)
          and coalesce(current_setting('pickuply.admin_assign', true), '') = 'yes'
        )
      ) then
      raise exception 'only an admin can assign a driver';
    end if;

    if (
      new.payment_status is distinct from old.payment_status
      or new.payment_due_at is distinct from old.payment_due_at
    ) and not (
      coalesce(public.is_migration_session(), false)
      or coalesce(public.is_admin(), false)
      or booking_step
    ) then
      raise exception 'only the booking step can set payment status';
    end if;

    if (
      new.payment_status is distinct from old.payment_status
      or new.payment_due_at is distinct from old.payment_due_at
    )
      and coalesce(public.is_admin(), false)
      and not coalesce(public.is_migration_session(), false)
      and not booking_step then
      insert into public.audit_log (actor_id, action, target_type, target_id, data)
      values (
        auth.uid(),
        'set_payment_status',
        'job',
        new.id,
        jsonb_build_object('payment_status', new.payment_status)
      );
    end if;
  end if;

  if tg_op = 'INSERT' then
    if (
      new.price_cents is not null
      or new.driver_pay_cents is not null
      or new.platform_fee_cents is not null
      or new.service_fee_cents is not null
      or new.dump_fee_cents is not null
      or new.quote_expires_at is not null
    ) and not prices_allowed then
      raise exception 'only an admin can set quote prices';
    end if;
  elsif (
    new.price_cents is distinct from old.price_cents
    or new.driver_pay_cents is distinct from old.driver_pay_cents
    or new.platform_fee_cents is distinct from old.platform_fee_cents
    or new.service_fee_cents is distinct from old.service_fee_cents
    or new.dump_fee_cents is distinct from old.dump_fee_cents
    or new.quote_expires_at is distinct from old.quote_expires_at
  ) and not prices_allowed then
    raise exception 'only an admin can change quote prices';
  end if;

  if tg_op = 'INSERT' and new.status = 'assigned' then
    raise exception 'assignment only follows an open job';
  end if;
  if tg_op = 'INSERT'
    and new.pricing_method = 'quote'
    and new.status = 'open'
    and current_setting('pickuply.quote_accepted', true) is distinct from 'yes' then
    raise exception 'a quote job is published only when the customer accepts it';
  end if;

  if new.status in ('requested', 'in_review', 'quoted', 'open') and new.assigned_driver_id is not null then
    raise exception 'assigned_driver_id is set only when a driver is assigned';
  end if;
  if new.status = 'assigned' and new.assigned_driver_id is null then
    raise exception 'an assigned job needs an assigned driver';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- Lock the job before the offer so two choices cannot deadlock on opposite rows.
create or replace function public.choose_offer(target_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  offer_row public.job_offers%rowtype;
  job_row public.jobs%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into offer_row from public.job_offers where id = target_offer;
  if not found or offer_row.status <> 'active' or offer_row.expires_at <= now() then
    raise exception 'that offer is no longer available';
  end if;
  select * into job_row from public.jobs where id = offer_row.job_id for update;
  if not found or job_row.customer_id is distinct from uid or job_row.status <> 'open' then
    raise exception 'only the customer can choose an offer on an open job';
  end if;
  select * into offer_row from public.job_offers where id = target_offer for update;
  if not found or offer_row.status <> 'active' or offer_row.expires_at <= now() then
    raise exception 'that offer is no longer available';
  end if;

  perform set_config('pickuply.offer_chosen', 'yes', true);
  update public.job_offers
  set status = 'chosen'
  where id = target_offer;
  update public.job_offers
  set status = 'declined'
  where job_id = offer_row.job_id and id <> target_offer and status = 'active';
  update public.jobs
  set
    status = 'assigned',
    assigned_driver_id = offer_row.driver_id,
    accepted_offer_id = target_offer,
    price_cents = offer_row.customer_total_cents,
    driver_pay_cents = offer_row.driver_amount_cents,
    platform_fee_cents = offer_row.platform_fee_cents,
    service_fee_cents = offer_row.service_fee_cents,
    payment_status = 'awaiting_payment',
    payment_due_at = public.payment_due_at()
  where id = offer_row.job_id;

  insert into public.job_events (job_id, actor_id, type, data)
  values (
    offer_row.job_id,
    uid,
    'offer_chosen',
    jsonb_build_object('offer_id', target_offer, 'to', 'assigned')
  );
end;
$function$;

-- driver_is_eligible_for_job follows auth.uid(), so an admin assigns by checking the target driver.
create or replace function public.admin_assign_driver(target_job uuid, target_driver uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  driver_row public.drivers%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can assign a driver';
  end if;

  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.status <> 'open' then
    raise exception 'job already taken';
  end if;
  if job_row.zone_id is null or job_row.service_level is null or job_row.required_vehicle is null then
    raise exception 'that driver cannot take this job';
  end if;

  select * into driver_row
  from public.drivers
  where profile_id = target_driver;
  if not found
    or driver_row.status not in ('active', 'approved_new')
    or not driver_row.is_online
    or driver_row.zone_id is distinct from job_row.zone_id
    or not (job_row.service = any (driver_row.services))
    or (job_row.service_level = 'full' and driver_row.service_level <> 'full')
    or not exists (
      select 1 from public.profiles
      where id = target_driver and role = 'driver' and not blocked
    )
    or not exists (
      select 1 from public.vehicles
      where driver_id = target_driver and approved and type = job_row.required_vehicle
    )
    or (
      driver_row.status = 'approved_new'
      and not exists (
        select 1 from public.job_driver_invitations
        where job_id = target_job and driver_id = target_driver
      )
    )
    or exists (
      select 1 from public.customer_driver_blocks
      where customer_id = job_row.customer_id and driver_id = target_driver
    ) then
    raise exception 'that driver cannot take this job';
  end if;

  perform set_config('pickuply.admin_assign', 'yes', true);
  update public.jobs
  set
    status = 'assigned',
    assigned_driver_id = target_driver,
    payment_status = 'awaiting_payment',
    payment_due_at = public.payment_due_at()
  where id = target_job;

  insert into public.job_events (job_id, actor_id, type, data)
  values (
    target_job,
    auth.uid(),
    'driver_assigned',
    jsonb_build_object('driver_id', target_driver, 'to', 'assigned')
  );
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'assign_driver',
    'job',
    target_job,
    jsonb_build_object('driver_id', target_driver)
  );
end;
$function$;

revoke all on function public.admin_assign_driver(uuid, uuid) from public;
revoke all on function public.admin_assign_driver(uuid, uuid) from anon;
revoke all on function public.admin_assign_driver(uuid, uuid) from service_role;
grant execute on function public.admin_assign_driver(uuid, uuid) to authenticated;
