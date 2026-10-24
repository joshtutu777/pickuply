-- An open detail question does not block driver offers.
-- A paused request rejects a new offer even if the insert skips the app.

create or replace function public.guard_offers_while_paused()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from 'active' then
    return new;
  end if;
  if exists (
    select 1
    from public.jobs
    where id = new.job_id
      and paused_at is not null
  ) then
    raise exception 'this request is paused';
  end if;
  return new;
end;
$$;

drop trigger if exists job_offers_reject_paused on public.job_offers;
create trigger job_offers_reject_paused
  before insert on public.job_offers
  for each row execute function public.guard_offers_while_paused();
