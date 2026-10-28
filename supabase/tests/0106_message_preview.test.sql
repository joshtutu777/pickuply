begin;

select plan(9);

create or replace function pg_temp.as_user(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

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

select pg_temp.make_user('c1060000-0000-4000-8000-000000000001', 'preview-customer@pickuply.test');
select pg_temp.make_user('c1060000-0000-4000-8000-000000000002', 'preview-driver@pickuply.test');
select pg_temp.make_user('c1060000-0000-4000-8000-000000000003', 'preview-other@pickuply.test');
update public.profiles set full_name = 'Sam Customer' where id = 'c1060000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'Ada Driver' where id = 'c1060000-0000-4000-8000-000000000002';
update public.profiles set role = 'driver', full_name = 'Other Driver' where id = 'c1060000-0000-4000-8000-000000000003';

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method
) values
  ('c1060000-0000-4000-8000-000000000010', 'c1060000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Norcross 30071', 'Duluth 30096', 'Sofa pickup', 1, 'medium', 0, 0, false, false, 'asap', 'fixed'),
  ('c1060000-0000-4000-8000-000000000011', 'c1060000-0000-4000-8000-000000000001', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'), 'Norcross 30071', 'Duluth 30096', 'Table pickup', 1, 'medium', 0, 0, false, false, 'asap', 'fixed');

set session_replication_role = replica;
update public.jobs
set status = 'assigned', assigned_driver_id = 'c1060000-0000-4000-8000-000000000002'
where id in ('c1060000-0000-4000-8000-000000000010', 'c1060000-0000-4000-8000-000000000011');
set session_replication_role = origin;

insert into public.message_threads (id, job_id, requester_id, driver_id, kind) values
  ('c1060000-0000-4000-8000-0000000000a1', 'c1060000-0000-4000-8000-000000000010', 'c1060000-0000-4000-8000-000000000001', 'c1060000-0000-4000-8000-000000000002', 'job'),
  ('c1060000-0000-4000-8000-0000000000a2', 'c1060000-0000-4000-8000-000000000011', 'c1060000-0000-4000-8000-000000000001', 'c1060000-0000-4000-8000-000000000002', 'job');

select pg_temp.as_user('c1060000-0000-4000-8000-000000000003');
select is(
  (select count(*) from public.job_message_summary('c1060000-0000-4000-8000-000000000010'))::integer,
  0,
  'an unassigned driver cannot open the job conversation'
);
select throws_ok(
  $$select public.post_message_once(
    'c1060000-0000-4000-8000-0000000000a1',
    'Can I take this?',
    'c1060000-0000-4000-8000-0000000000c1'
  )$$,
  'you cannot post in this thread',
  'an unassigned driver cannot send a message'
);

select pg_temp.as_user('c1060000-0000-4000-8000-000000000001');
select public.post_message_once(
  'c1060000-0000-4000-8000-0000000000a1',
  'I am about 10 minutes away.',
  'c1060000-0000-4000-8000-0000000000c2'
);
select public.post_message_once(
  'c1060000-0000-4000-8000-0000000000a1',
  'I am about 10 minutes away.',
  'c1060000-0000-4000-8000-0000000000c2'
);
select is(
  (select count(*) from public.messages where thread_id = 'c1060000-0000-4000-8000-0000000000a1')::integer,
  1,
  'a retry uses the same key and does not create a second message'
);
set local role postgres;
select is(
  (select count(*) from public.notifications
    where profile_id = 'c1060000-0000-4000-8000-000000000002'
      and dedupe_key = 'message:' || (select id::text from public.messages where thread_id = 'c1060000-0000-4000-8000-0000000000a1'))::integer,
  1,
  'the retry does not create a second alert'
);

select pg_temp.as_user('c1060000-0000-4000-8000-000000000002');
set local role authenticated;
select public.post_message('c1060000-0000-4000-8000-0000000000a2', 'The table is ready.');
select is(
  (select count(*) from public.my_inbox() where job_id in (
    'c1060000-0000-4000-8000-000000000010',
    'c1060000-0000-4000-8000-000000000011'
  ))::integer,
  2,
  'two bookings between the same people stay separate'
);
select is(
  (select participant_name || '|' || participant_role || '|' || job_label || '|' || pickup_label || '|' || dropoff_label
    from public.my_inbox()
    where job_id = 'c1060000-0000-4000-8000-000000000010'),
  'Sam|Customer|Pickup · Sofa pickup|Norcross|Duluth',
  'the driver preview names the customer and the cities'
);
select is(
  (select snippet from public.job_message_summary('c1060000-0000-4000-8000-000000000010')),
  'I am about 10 minutes away.',
  'the job card shows the latest message for that job only'
);

set local role postgres;
insert into storage.objects (bucket_id, name, metadata)
values ('message-files', 'c1060000-0000-4000-8000-0000000000a1/too-big.jpg', '{"size":"6000000","mimetype":"image/jpeg"}'::jsonb);
select pg_temp.as_user('c1060000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.register_message_file(
    'c1060000-0000-4000-8000-0000000000a1',
    'c1060000-0000-4000-8000-0000000000a1/notes.txt'
  )$$,
  'choose a photo or PDF',
  'a text file is rejected'
);
select throws_ok(
  $$select public.register_message_file(
    'c1060000-0000-4000-8000-0000000000a1',
    'c1060000-0000-4000-8000-0000000000a1/too-big.jpg'
  )$$,
  'choose a photo or PDF under 5 MB',
  'a file over 5 MB is rejected'
);

select * from finish();
rollback;
