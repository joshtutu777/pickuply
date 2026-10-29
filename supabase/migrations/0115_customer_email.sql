-- A new real customer's booking must include an email. Existing rows are left as they are.
-- A blank profile save still does not erase an email. Test accounts stay compatible.
-- Do not apply this file to the hosted project until the owner approves it.

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
  cleaned := nullif(lower(btrim(coalesce(next_email, ''))), '');
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

create or replace function public.job_private_require_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  test_customer boolean;
begin
  select profiles.is_test into test_customer
  from public.jobs
  join public.profiles on profiles.id = jobs.customer_id
  where jobs.id = new.job_id;

  new.customer_email := nullif(lower(btrim(coalesce(new.customer_email, ''))), '');
  if coalesce(test_customer, false) then
    return new;
  end if;
  if new.customer_email is null
    or char_length(new.customer_email) > 200
    or new.customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception 'email is not valid';
  end if;
  return new;
end;
$$;

revoke all on function public.job_private_require_email() from public, anon, authenticated, service_role;

drop trigger if exists job_private_require_email on public.job_private;
create trigger job_private_require_email
  before insert on public.job_private
  for each row execute function public.job_private_require_email();
