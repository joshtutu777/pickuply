-- Optional SMS notification consent. A phone number alone is not consent.
-- Do not apply this file to the hosted project until the owner approves.

create table public.sms_consents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  consented_at timestamptz not null default now(),
  disclosure_version text not null,
  source text not null,
  constraint sms_consents_source check (source in ('login', 'driver_onboarding'))
);

create index sms_consents_profile_id_idx on public.sms_consents (profile_id, consented_at);

alter table public.sms_consents enable row level security;

create policy sms_consents_select_own on public.sms_consents
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

revoke all on table public.sms_consents from public;
revoke all on table public.sms_consents from anon;
revoke all on table public.sms_consents from authenticated;
grant select on table public.sms_consents to authenticated;

-- The version is the disclosure shown in components/sms-consent.tsx.
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
  values (auth.uid(), '2026-10-22', consent_source);
end;
$$;

revoke all on function public.record_sms_consent(text) from public;
revoke all on function public.record_sms_consent(text) from anon;
revoke all on function public.record_sms_consent(text) from service_role;
grant execute on function public.record_sms_consent(text) to authenticated;
