-- Optional SMS consent can be turned off. A phone number alone is still not consent.
-- Local only until the owner applies it to the hosted database.

alter table public.sms_consents
  add column if not exists opted_out_at timestamptz;

create or replace function public.record_sms_consent(consent_source text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  if consent_source not in ('login', 'driver_onboarding') then
    raise exception 'consent source is not valid';
  end if;
  insert into public.sms_consents (profile_id, disclosure_version, source)
  values (auth.uid(), '2026-10-23', consent_source);
  insert into public.notification_preferences (profile_id, sms_enabled)
  values (auth.uid(), true)
  on conflict (profile_id) do update
    set sms_enabled = true,
        updated_at = now();
end;
$$;

create or replace function public.save_notification_preferences(
  push_on boolean,
  email_on boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  insert into public.notification_preferences (profile_id, push_enabled, email_enabled, sms_enabled)
  values (auth.uid(), coalesce(push_on, true), coalesce(email_on, true), false)
  on conflict (profile_id) do update
    set push_enabled = excluded.push_enabled,
        email_enabled = excluded.email_enabled,
        updated_at = now();
end;
$$;

-- Called by the inbound SMS webhook with the service role. It does not send a text.
create or replace function public.record_sms_opt_out(target_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  select id into owner
  from auth.users
  where phone = target_phone
  limit 1;
  if owner is null then
    return;
  end if;
  update public.sms_consents
    set opted_out_at = now()
    where profile_id = owner
      and opted_out_at is null;
  insert into public.notification_preferences (profile_id, sms_enabled)
  values (owner, false)
  on conflict (profile_id) do update
    set sms_enabled = false,
        updated_at = now();
end;
$$;

revoke all on function public.record_sms_opt_out(text) from public, anon, authenticated;
grant execute on function public.record_sms_opt_out(text) to service_role;
