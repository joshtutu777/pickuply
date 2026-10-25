-- A driver can update vehicle details after approval.
-- The approved flag still changes only through admin review.
-- Local only until the owner applies this to the hosted database.

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
  if tg_op = 'UPDATE' and old.approved and new.approved then
    return new;
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
