-- Replaces the fixed hourly phone and network quotas with a cooldown,
-- a daily cap per number, and distinct-number abuse checks.
-- Stores hashes only. A refused request does not add a row.
-- Do not apply this file until the owner approves it.

create table public.otp_send_log (
  id bigint generated always as identity primary key,
  phone_key text not null,
  ip_key text not null,
  created_at timestamptz not null default now()
);

create index otp_send_log_phone_created on public.otp_send_log (phone_key, created_at desc);
create index otp_send_log_ip_created on public.otp_send_log (ip_key, created_at desc);

alter table public.otp_send_log enable row level security;

create table public.otp_verify_failures (
  id bigint generated always as identity primary key,
  phone_key text not null,
  created_at timestamptz not null default now()
);

create index otp_verify_failures_phone_created on public.otp_verify_failures (phone_key, created_at desc);

alter table public.otp_verify_failures enable row level security;

create or replace function public.reserve_otp_send(phone_key text, ip_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  burst_count integer;
  sustained_count integer;
  phone_count integer;
begin
  if phone_key is null or length(phone_key) < 16 or ip_key is null or length(ip_key) < 16 then
    raise exception 'A phone is required.';
  end if;
  perform pg_advisory_xact_lock(hashtext('otp-send'));
  delete from public.otp_send_log where created_at < now() - interval '24 hours';

  if exists (
    select 1 from public.otp_send_log
    where otp_send_log.phone_key = reserve_otp_send.phone_key
      and created_at > now() - interval '30 seconds'
  ) then
    raise exception 'Wait 30 seconds before requesting another code.';
  end if;

  select count(*) into phone_count
  from public.otp_send_log
  where otp_send_log.phone_key = reserve_otp_send.phone_key
    and created_at > now() - interval '24 hours';
  if phone_count >= 20 then
    raise exception 'Too many codes for this number today. Try again tomorrow.';
  end if;

  select count(distinct otp_send_log.phone_key) into burst_count
  from public.otp_send_log
  where otp_send_log.ip_key = reserve_otp_send.ip_key
    and created_at > now() - interval '10 minutes';
  if burst_count >= 15 and not exists (
    select 1 from public.otp_send_log
    where otp_send_log.ip_key = reserve_otp_send.ip_key
      and otp_send_log.phone_key = reserve_otp_send.phone_key
      and created_at > now() - interval '10 minutes'
  ) then
    raise exception 'Too many new numbers from this network right now. Try again in a few minutes.';
  end if;

  select count(distinct otp_send_log.phone_key) into sustained_count
  from public.otp_send_log
  where otp_send_log.ip_key = reserve_otp_send.ip_key
    and created_at > now() - interval '1 hour';
  if sustained_count >= 80 and not exists (
    select 1 from public.otp_send_log
    where otp_send_log.ip_key = reserve_otp_send.ip_key
      and otp_send_log.phone_key = reserve_otp_send.phone_key
      and created_at > now() - interval '1 hour'
  ) then
    raise exception 'Too many new numbers from this network. Try again later.';
  end if;

  insert into public.otp_send_log (phone_key, ip_key) values (phone_key, ip_key);
end;
$$;

revoke all on function public.reserve_otp_send(text, text) from public, anon, authenticated;
grant execute on function public.reserve_otp_send(text, text) to service_role;

create or replace function public.otp_verify_allowed(phone_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  seen integer;
begin
  if phone_key is null or length(phone_key) < 16 then
    raise exception 'A phone is required.';
  end if;
  perform pg_advisory_xact_lock(hashtext('otp-verify'));
  delete from public.otp_verify_failures where created_at < now() - interval '10 minutes';
  select count(*) into seen
  from public.otp_verify_failures
  where otp_verify_failures.phone_key = otp_verify_allowed.phone_key
    and created_at > now() - interval '10 minutes';
  if seen >= 5 then
    raise exception 'Too many incorrect codes. Wait 10 minutes and request a new one.';
  end if;
end;
$$;

revoke all on function public.otp_verify_allowed(text) from public, anon, authenticated;
grant execute on function public.otp_verify_allowed(text) to service_role;

create or replace function public.note_otp_verify_failure(phone_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if phone_key is null or length(phone_key) < 16 then
    raise exception 'A phone is required.';
  end if;
  perform pg_advisory_xact_lock(hashtext('otp-verify'));
  insert into public.otp_verify_failures (phone_key) values (phone_key);
end;
$$;

revoke all on function public.note_otp_verify_failure(text) from public, anon, authenticated;
grant execute on function public.note_otp_verify_failure(text) to service_role;
