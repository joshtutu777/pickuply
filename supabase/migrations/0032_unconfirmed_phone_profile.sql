-- A phone that has only been sent a code is not a customer yet.
-- The profile appears when the code is confirmed. Do not apply this to hosted
-- until that project is ready for migrations after 0013.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.phone is not null and new.phone_confirmed_at is null and new.email is null then
    return new;
  end if;
  insert into public.profiles (id, role, phone, email)
  values (new.id, 'customer', new.phone, new.email);
  return new;
end;
$$;

create or replace function public.handle_phone_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.phone_confirmed_at is not null and old.phone_confirmed_at is null then
    insert into public.profiles (id, role, phone, email)
    values (new.id, 'customer', new.phone, new.email)
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_phone_confirmed on auth.users;
create trigger on_auth_user_phone_confirmed
  after update of phone_confirmed_at on auth.users
  for each row execute function public.handle_phone_confirmed();

revoke all on function public.handle_phone_confirmed() from public, anon, authenticated, service_role;
