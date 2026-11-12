-- Payout setup holds a driver's earnings. It does not block an offer or a claim.
-- An approved, Online driver can submit an offer before Stripe payouts are ready.

create or replace function public.assert_driver_can_take_job(target_job uuid, action text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  driver_row public.drivers%rowtype;
  job_row public.jobs%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if public.account_is_suspended(uid) then
    raise exception 'Your Pickuply driver account is restricted. You cannot submit offers or accept new jobs while this restriction is active.';
  end if;
  if exists (select 1 from public.drivers where profile_id = uid and driving_stopped_at is not null) then
    raise exception 'You stopped driving. You cannot submit offers or accept new jobs.';
  end if;
  if public.phone_is_restricted((select phone from public.profiles where id = uid)) then
    raise exception 'This phone number cannot be used for Pickuply right now. Contact support if you think this is a mistake.';
  end if;
  select * into driver_row from public.drivers where profile_id = uid;
  if not found or driver_row.status not in ('active', 'approved_new') then
    raise exception 'Finish setup to accept jobs.';
  end if;
  if not driver_row.is_online then
    if action = 'offer' then
      raise exception 'go online before sending an offer';
    end if;
    raise exception 'go online before claiming a job';
  end if;
  select * into job_row from public.jobs where id = target_job;
  if found and (public.account_is_suspended(job_row.customer_id) or job_row.suspension_hold) then
    raise exception 'This request is no longer available.';
  end if;
  if found and job_row.required_vehicle is not null and not exists (
    select 1 from public.vehicles
    where driver_id = uid and type = job_row.required_vehicle
  ) then
    raise exception 'This job needs a different vehicle.';
  end if;
  if not public.driver_is_eligible_for_job(target_job) then
    if action = 'offer' then
      raise exception 'this driver cannot offer on this job';
    end if;
    raise exception 'this driver cannot claim this job';
  end if;
end;
$function$;
