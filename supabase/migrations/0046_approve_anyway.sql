-- Missing insurance does not block Online after approval.
-- An uploaded policy that has expired still does.
-- Approving with a missing document requires an explicit confirmation.

create or replace function public.set_driver_online(go_online boolean)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  driver_row public.drivers%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  select * into driver_row from public.drivers where profile_id = uid;
  if not found then
    raise exception 'driver profile not found';
  end if;

  if go_online then
    if driver_row.status not in ('active', 'approved_new') then
      raise exception 'Finish these steps. You can go Online after Pickuply approves you.';
    end if;
    if driver_row.license_url is null or driver_row.license_expires is null then
      raise exception 'Add your driver license before going Online.';
    end if;
    if driver_row.license_expires < current_date then
      raise exception 'Your license expired on % - upload a new photo to go Online.',
        to_char(driver_row.license_expires, 'FMMM/FMDD/YYYY');
    end if;
    if driver_row.insurance_expires is not null and driver_row.insurance_expires < current_date then
      raise exception 'Your insurance expired on % - upload a new card to go Online.',
        to_char(driver_row.insurance_expires, 'FMMM/FMDD/YYYY');
    end if;
    if driver_row.terms_accepted_at is null and driver_row.agreement_signed_at is null then
      raise exception 'Agree to the Driver Terms before going Online.';
    end if;
  end if;

  perform set_config('pickuply.driver_online', 'yes', true);
  update public.drivers
  set
    is_online = go_online,
    first_online_at = case
      when go_online then coalesce(first_online_at, now())
      else first_online_at
    end
  where profile_id = uid;
end;
$function$;

create or replace function public.review_driver(
  target_driver uuid,
  decision text,
  note text,
  approve_anyway boolean
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
  missing text[] := '{}';
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
    if driver_row.license_url is null then
      missing := array_append(missing, 'No license on file.');
    end if;
    if driver_row.insurance_url is null then
      missing := array_append(missing, 'No insurance on file.');
    end if;
    if not exists (select 1 from public.vehicles where driver_id = target_driver) then
      missing := array_append(missing, 'No vehicle on file.');
    end if;
    if cardinality(missing) > 0 and not approve_anyway then
      raise exception 'confirm approve anyway';
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
    perform public.enqueue_notification(
      target_driver,
      null,
      'driver_approved',
      'You''re ready to drive',
      'You''re ready to drive! Switch Online whenever you''re ready to start accepting jobs.',
      '/driver',
      'driver-approved:' || target_driver::text
    );
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
    jsonb_build_object(
      'decision', decision,
      'note', nullif(btrim(coalesce(note, '')), ''),
      'missing_documents', to_jsonb(missing),
      'approve_anyway', approve_anyway
    )
  );
end;
$function$;

create or replace function public.review_driver(target_driver uuid, decision text, note text)
returns void
language sql
security definer
set search_path = public
as $$
  select public.review_driver(target_driver, decision, note, false);
$$;

grant execute on function public.review_driver(uuid, text, text, boolean) to authenticated;
grant execute on function public.review_driver(uuid, text, text) to authenticated;
