-- Remember the first time a driver goes Online so the approval prompt can go away.
-- Local only until the owner applies it to the hosted database.

alter table public.drivers
  add column if not exists first_online_at timestamptz;

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
      raise exception 'Your license expired on % — upload a new photo to go Online.',
        to_char(driver_row.license_expires, 'FMMM/FMDD/YYYY');
    end if;
    if driver_row.insurance_url is null or driver_row.insurance_expires is null then
      raise exception 'Add your insurance card before going Online.';
    end if;
    if driver_row.insurance_expires < current_date then
      raise exception 'Your insurance expired on % — upload a new card to go Online.',
        to_char(driver_row.insurance_expires, 'FMMM/FMDD/YYYY');
    end if;
    if driver_row.agreement_signed_at is null then
      raise exception 'Sign the driver agreement before going Online.';
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
