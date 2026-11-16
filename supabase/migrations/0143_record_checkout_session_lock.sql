-- Recording a checkout session locks the job first, the same row removal locks.
-- A cancelled, released, or stale attempt cannot replace the stored session.
-- A later retry still uses the next attempt number. The same session can be saved again.

create or replace function public.record_checkout_session(
  target_job uuid,
  session_id text,
  attempt integer
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  payment_row public.job_payments%rowtype;
  started_sessions integer;
begin
  if session_id is null or session_id !~ '^cs_[A-Za-z0-9_]+$' then
    raise exception 'checkout session is missing';
  end if;

  select * into job_row
  from public.jobs
  where id = target_job
  for update;
  if not found then
    raise exception 'checkout attempt does not match';
  end if;

  select * into payment_row
  from public.job_payments
  where job_id = target_job
  for update;

  if not found or payment_row.checkout_attempt is distinct from attempt then
    raise exception 'checkout attempt does not match';
  end if;
  if job_row.status = 'cancelled' then
    raise exception 'this request was cancelled';
  end if;
  if job_row.status is distinct from 'assigned'
    or job_row.payment_status not in ('awaiting_payment', 'failed')
    or job_row.assigned_driver_id is null
    or job_row.assigned_driver_id is distinct from payment_row.checkout_driver_id then
    raise exception 'this job is not waiting for payment';
  end if;

  if payment_row.checkout_session_id is not null
    and payment_row.checkout_session_id is distinct from session_id then
    select count(distinct checkout_session_id) into started_sessions
    from public.payment_attempts
    where job_id = target_job
      and outcome = 'started'
      and checkout_session_id is not null;
    if coalesce(started_sessions, 0) >= attempt then
      raise exception 'checkout attempt does not match';
    end if;
  end if;

  update public.job_payments
  set checkout_session_id = session_id, updated_at = now()
  where job_id = target_job
    and checkout_attempt = attempt;
  if not found then
    raise exception 'checkout attempt does not match';
  end if;

  insert into public.payment_attempts (job_id, checkout_session_id, outcome)
  select target_job, session_id, 'started'
  where not exists (
    select 1
    from public.payment_attempts
    where job_id = target_job
      and checkout_session_id = session_id
      and outcome = 'started'
  );
end;
$function$;

revoke all on function public.record_checkout_session(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.record_checkout_session(uuid, text, integer) to service_role;
