-- Optional profile email. One column on profiles, shared by customers and drivers.
-- A blank value does not erase an email that is already saved.
-- This does not confirm the address and does not change phone sign-in.

create or replace function public.save_profile_email(next_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text;
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  cleaned := nullif(btrim(coalesce(next_email, '')), '');
  if cleaned is null then
    return;
  end if;
  if char_length(cleaned) > 200 or cleaned !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception 'email is not valid';
  end if;
  update public.profiles
  set email = cleaned
  where id = auth.uid();
end;
$$;

revoke all on function public.save_profile_email(text) from public, anon, service_role;
grant execute on function public.save_profile_email(text) to authenticated;
