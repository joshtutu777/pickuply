-- A guest reply does not become Awaiting Customer inside the database.

begin;

create or replace function public.admin_support_message(ticket uuid, message text, note boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  person uuid := auth.uid();
  clean text := btrim(message);
  owner uuid;
  test_account boolean;
  sent timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if clean = '' or char_length(clean) > 4000 then
    raise exception 'Write a message under 4000 characters.';
  end if;
  select profile_id, is_test into owner, test_account from public.support_tickets where id = ticket;
  if not found then
    raise exception 'That request was not found.';
  end if;
  insert into public.support_ticket_messages (ticket_id, author_id, kind, body)
  values (ticket, person, case when note then 'internal' else 'admin' end, clean);
  if not note then
    update public.support_tickets
    set assigned_admin_id = coalesce(assigned_admin_id, person),
        status = case when owner is not null then 'awaiting_customer' else status end
    where id = ticket;
    if owner is not null then
      sent := case when test_account then now() else null end;
      insert into public.notifications (profile_id, kind, title, body, href, dedupe_key, push_sent_at, email_sent_at, sms_sent_at)
      values (
        owner, 'support', 'Support replied to your request.', 'Open your request to read the reply.',
        '/contact/tickets/' || ticket::text, 'support-customer-' || ticket::text || '-' || extract(epoch from now())::bigint,
        sent, sent, sent
      );
    end if;
  end if;
end;
$$;

select plan(2);

do $$
declare
  sch text;
begin
  for sch in
    select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'ok'
  loop
    execute format('grant usage on schema %I to anon, authenticated, service_role', sch);
    execute format('grant execute on all functions in schema %I to anon, authenticated, service_role', sch);
  end loop;
end $$;

create or replace function pg_temp.make_user(uid uuid, email text)
returns void language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    email, 'test-hash', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now(), uid::text, '', uid::text || '-email', uid::text || '-recovery'
  );
end;
$$;

create or replace function pg_temp.as_user(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.make_user('c1880000-0000-4000-8000-000000000003', 'support-admin-guest@pickuply.test');
update public.profiles set role = 'admin' where id = 'c1880000-0000-4000-8000-000000000003';

set local role anon;
select public.create_support_ticket('Guest', '', 'guest-release@example.com', 'other', 'I need a hand.', '', null);

reset role;
select pg_temp.as_user('c1880000-0000-4000-8000-000000000003');
set local role authenticated;
select public.admin_support_message(
  (select id from public.support_tickets where email = 'guest-release@example.com'),
  'We can help.',
  false
);

select is(
  (select status from public.support_tickets where email = 'guest-release@example.com'),
  'open',
  'a guest reply stays open until email delivery is recorded'
);
select is(
  (select count(*) from public.support_ticket_messages where body = 'We can help.'),
  1::bigint,
  'the guest reply is saved for the admin'
);

select * from finish();
rollback;
