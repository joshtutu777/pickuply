-- Latest result for each scheduled job. The admin health page reads this table.
-- Do not apply this file to the hosted project until the owner approves it.
-- Recording a run does not start the job and does not move money.

create table public.cron_job_runs (
  job_name text primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  ok boolean not null,
  error_message text,
  constraint cron_job_runs_name check (
    job_name in (
      'funnel-retention',
      'payment-deadlines',
      'notifications',
      'auto-complete',
      'transfers'
    )
  ),
  constraint cron_job_runs_error_len check (
    error_message is null or char_length(error_message) <= 300
  )
);

alter table public.cron_job_runs enable row level security;

create policy cron_job_runs_real_admin_read on public.cron_job_runs
  for select to authenticated
  using (public.is_admin() and not public.actor_is_test());

revoke all on public.cron_job_runs from public, anon, authenticated, service_role;
grant select on public.cron_job_runs to authenticated;

create or replace function public.record_cron_run(
  target_job text,
  started_at timestamptz,
  finished_at timestamptz,
  succeeded boolean,
  error_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'only the scheduler can record a cron run';
  end if;
  if target_job not in (
    'funnel-retention',
    'payment-deadlines',
    'notifications',
    'auto-complete',
    'transfers'
  ) then
    raise exception 'unknown scheduled job';
  end if;
  cleaned := left(
    btrim(
      regexp_replace(
        coalesce(error_message, ''),
        '(Bearer[[:space:]]+[^[:space:]]+|sk_(test|live)_[^[:space:]]+|whsec_[^[:space:]]+)',
        '[redacted]',
        'gi'
      )
    ),
    300
  );
  if succeeded or cleaned = '' then
    cleaned := null;
  end if;
  insert into public.cron_job_runs (job_name, started_at, finished_at, ok, error_message)
  values (target_job, started_at, finished_at, succeeded, cleaned)
  on conflict (job_name) do update
  set started_at = excluded.started_at,
      finished_at = excluded.finished_at,
      ok = excluded.ok,
      error_message = excluded.error_message;
end;
$$;

revoke all on function public.record_cron_run(text, timestamptz, timestamptz, boolean, text)
  from public, anon, authenticated;
grant execute on function public.record_cron_run(text, timestamptz, timestamptz, boolean, text)
  to service_role;
