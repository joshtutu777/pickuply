-- The platform grants anon every privilege on new public tables, and on
-- storage.objects and storage.buckets. This migration takes those grants
-- back from sensitive tables. zones stays readable by anon: zone names are
-- public reference data, and the zone policy allows an anonymous select.
--
-- Signup and the text-code login use the Auth API. The new-user trigger
-- inserts the profile as security definer. The health check calls the Auth
-- health endpoint. None of those read or write the tables below.
--
-- Privileges removed from anon on each public table, where this migration
-- role is the grantor: DELETE, INSERT, REFERENCES, SELECT, TRIGGER,
-- TRUNCATE, UPDATE.
--
-- storage.objects and storage.buckets are granted to anon by
-- supabase_storage_admin. This migration role cannot revoke another role's
-- grant, so those two REVOKE statements do nothing here. Row level security
-- still hides the private photos. A superuser, such as the hosted SQL editor,
-- can revoke DELETE, INSERT, SELECT, and UPDATE on those two tables.

revoke all on table
  public.profiles,
  public.drivers,
  public.vehicles,
  public.jobs,
  public.job_private,
  public.job_photos,
  public.job_offers,
  public.job_events,
  public.audit_log,
  public.customer_driver_blocks,
  public.job_driver_invitations
from anon;

revoke all on table
  storage.objects,
  storage.buckets
from anon;
