-- Manual admin promotion. This is not a migration. Do not run it from the app.
-- Run it yourself in the Supabase SQL editor after that phone has signed in once.
-- The editor runs as the database owner, which is allowed to change a role.
-- Replace the placeholder on the next insert. If you leave +1XXXXXXXXXX, nothing changes.
-- Phone digits are compared, so a leading + does not matter.

begin;

create temporary table promote_admin_phone (
  phone text not null
) on commit drop;

insert into promote_admin_phone (phone)
values ('+1XXXXXXXXXX');

do $promote$
declare
  target_phone text;
  target_digits text;
  match_count bigint;
  target_id uuid;
  updated_count integer;
begin
  select btrim(phone) into target_phone from promote_admin_phone;

  if target_phone is null or upper(target_phone) = '+1XXXXXXXXXX' then
    raise exception 'Replace +1XXXXXXXXXX with the admin phone. Nothing was changed.';
  end if;

  target_digits := regexp_replace(target_phone, '\D', '', 'g');

  if target_digits = '' or target_digits = '1' then
    raise exception 'The phone placeholder is still in place. Nothing was changed.';
  end if;

  select count(*)
  into match_count
  from auth.users
  where regexp_replace(coalesce(phone, ''), '\D', '', 'g') = target_digits;

  if match_count <> 1 then
    raise exception 'Expected exactly 1 auth user with that phone, found %. Nothing was changed.', match_count;
  end if;

  select id
  into strict target_id
  from auth.users
  where regexp_replace(coalesce(phone, ''), '\D', '', 'g') = target_digits
  for update;

  update public.profiles
  set role = 'admin'
  where id = target_id;

  get diagnostics updated_count = row_count;

  if updated_count <> 1 then
    raise exception 'Expected exactly 1 profile to update, changed %. Nothing was kept.', updated_count;
  end if;
end
$promote$;

select p.id, p.role, u.phone
from public.profiles as p
join auth.users as u on u.id = p.id
join promote_admin_phone as t
  on regexp_replace(coalesce(u.phone, ''), '\D', '', 'g')
   = regexp_replace(btrim(t.phone), '\D', '', 'g');

commit;
