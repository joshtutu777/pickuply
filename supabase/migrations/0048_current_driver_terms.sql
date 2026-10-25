-- Online requires the current Driver Terms version.
-- Acceptance happens only when the driver calls accept_driver_terms.

create or replace function public.accept_driver_terms()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if not exists (select 1 from public.drivers where profile_id = uid) then
    raise exception 'driver profile not found';
  end if;
  update public.drivers
  set
    terms_version = 'driver-terms-v1',
    terms_accepted_at = now(),
    agreement_signed_at = coalesce(agreement_signed_at, now())
  where profile_id = uid;
end;
$$;

revoke all on function public.accept_driver_terms() from public, anon, service_role;
grant execute on function public.accept_driver_terms() to authenticated;

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
    if driver_row.terms_version is distinct from 'driver-terms-v1' then
      raise exception 'Accept the Driver Terms to go Online.';
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
