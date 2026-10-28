-- The new schedule triggers call is_migration_session, which normal users cannot execute.
-- The older booking-window trigger is already security definer for the same reason.
-- A customer request commits as the signed-in user, so these checks must run as the owner.

alter function public.guard_window_count() security definer;
alter function public.guard_confirmed_schedule() security definer;
alter function public.guard_pickup_windows() security definer;
alter function public.guard_offer_schedule() security definer;
