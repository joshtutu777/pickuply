-- A database session is the migration role only when nobody is signed in
-- and no JWT role or claims are present. The service role sets those claims
-- and must not be able to change quote prices. A normal migration still has
-- no JWT, so fixture setup and hosted SQL-editor maintenance keep working.

create or replace function public.is_migration_session()
returns boolean
language sql
stable
as $$
  select session_user in ('postgres', 'supabase_admin')
    and auth.uid() is null
    and coalesce(current_setting('request.jwt.claim.role', true), '') = ''
    and coalesce(current_setting('request.jwt.claims', true), '') = '';
$$;
