-- The booking-window trigger runs as the person saving the request.
-- It has to be able to skip the check during a migration session.

create or replace function public.guard_booking_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_migration_session() then
    return new;
  end if;
  if not public.booking_date_allowed(new.preferred_date) then
    raise exception 'Choose a date within the next 6 days.';
  end if;
  return new;
end;
$$;
