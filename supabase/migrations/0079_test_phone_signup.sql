-- A brand-new 555-555 number becomes a test account when the code is confirmed.
-- No profile is created ahead of time, so the person still signs up and enters a name.
-- An existing profile is left as it is.

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
  insert into public.profiles (id, role, phone, email, is_test)
  values (
    new.id,
    'customer',
    new.phone,
    new.email,
    right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 10) ~ '^555555[0-9]{4}$'
  );
  if public.phone_hmac_secret() is null then
    insert into public.audit_log (actor_id, action, target_type, target_id, data)
    values (new.id, 'phone_protection_missing', 'profile', new.id, jsonb_build_object('step', 'registration'));
  end if;
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
    insert into public.profiles (id, role, phone, email, is_test)
    values (
      new.id,
      'customer',
      new.phone,
      new.email,
      right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 10) ~ '^555555[0-9]{4}$'
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;
