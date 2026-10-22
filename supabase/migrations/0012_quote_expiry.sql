-- A quote with no expiry can still be accepted. A past expiry cannot.
-- Quotes created by review_request always store an expiry.

create or replace function public.accept_admin_quote(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;

  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.customer_id is distinct from auth.uid() then
    raise exception 'only the customer can accept this quote';
  end if;
  if job_row.pricing_method <> 'quote' or job_row.status <> 'quoted' then
    raise exception 'this job is not waiting for quote acceptance';
  end if;
  if job_row.price_cents is null or job_row.driver_pay_cents is null then
    raise exception 'the admin quote is incomplete';
  end if;
  if job_row.quote_expires_at is not null and job_row.quote_expires_at <= now() then
    raise exception 'this quote has expired';
  end if;

  perform set_config('pickuply.quote_accepted', 'yes', true);
  update public.jobs
  set status = 'open', updated_at = now()
  where id = target_job;

  insert into public.job_events (job_id, actor_id, type, data)
  values (
    target_job,
    auth.uid(),
    'quote_accepted',
    jsonb_build_object('to', 'open')
  );
end;
$$;
