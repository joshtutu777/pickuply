-- A failed transfer lookup is counted. It is not left unknown forever.
-- After three failures the sender may create with the same ledger id.
-- Do not apply this file to the hosted project until the owner approves it.

alter table public.stripe_transfer_claims
  add column lookup_failures integer not null default 0,
  add column last_lookup_error text;

alter table public.stripe_transfer_claims
  add constraint stripe_transfer_claims_lookup_failures check (lookup_failures >= 0),
  add constraint stripe_transfer_claims_lookup_error check (
    last_lookup_error is null or char_length(last_lookup_error) <= 300
  );

create or replace function public.note_transfer_lookup_failure(target_entry uuid, reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  next_count integer;
begin
  update public.stripe_transfer_claims
  set lookup_failures = lookup_failures + 1,
      last_lookup_error = left(btrim(coalesce(reason, 'lookup failed')), 300),
      updated_at = now()
  where ledger_id = target_entry
    and stripe_transfer_id is null
  returning lookup_failures into next_count;
  if next_count is null then
    raise exception 'transfer claim not found';
  end if;
  return next_count;
end;
$function$;

revoke all on function public.note_transfer_lookup_failure(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.note_transfer_lookup_failure(uuid, text) to service_role;
