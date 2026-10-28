begin;

select plan(19);

create or replace function pg_temp.as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'postgres', true);
end;
$$;

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

select pg_temp.make_user('c1070000-0000-4000-8000-000000000001', 'chat-customer@pickuply.test');
select pg_temp.make_user('c1070000-0000-4000-8000-000000000002', 'chat-driver@pickuply.test');
select pg_temp.make_user('c1070000-0000-4000-8000-000000000003', 'chat-admin@pickuply.test');
update public.profiles set full_name = 'Casey Customer' where id = 'c1070000-0000-4000-8000-000000000001';
update public.profiles set role = 'driver', full_name = 'Taylor Driver' where id = 'c1070000-0000-4000-8000-000000000002';
insert into public.drivers (profile_id) values ('c1070000-0000-4000-8000-000000000002');
update public.profiles set role = 'admin', full_name = 'Sky Admin' where id = 'c1070000-0000-4000-8000-000000000003';

insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method
) values (
  'c1070000-0000-4000-8000-000000000010', 'c1070000-0000-4000-8000-000000000001', 'delivery', 'open',
  (select id from public.zones where slug = 'west_metro'), 'Norcross 30071', 'Duluth 30096', 'Sofa pickup', 1, 'medium',
  0, 0, false, false, 'asap', 'fixed'
);

set local session_replication_role = replica;
update public.jobs
set status = 'assigned', assigned_driver_id = 'c1070000-0000-4000-8000-000000000002'
where id = 'c1070000-0000-4000-8000-000000000010';
set local session_replication_role = origin;

insert into public.message_threads (id, job_id, requester_id, driver_id, kind)
values (
  'c1070000-0000-4000-8000-0000000000a1',
  'c1070000-0000-4000-8000-000000000010',
  'c1070000-0000-4000-8000-000000000001',
  'c1070000-0000-4000-8000-000000000002',
  'job'
);

select pg_temp.as_user('c1070000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.post_message('c1070000-0000-4000-8000-0000000000a1', '(404) 555 1234')$$,
  'For your safety, contact details can''t be shared in chat',
  'a formatted phone number is rejected'
);
select throws_ok(
  $$select public.post_message('c1070000-0000-4000-8000-0000000000a1', '404.555.1234')$$,
  'For your safety, contact details can''t be shared in chat',
  'a dotted phone number is rejected'
);
select throws_ok(
  $$select public.post_message('c1070000-0000-4000-8000-0000000000a1', 'four zero four five five five one two three four')$$,
  'For your safety, contact details can''t be shared in chat',
  'spelled-out digits are rejected'
);
select throws_ok(
  $$select public.post_message('c1070000-0000-4000-8000-0000000000a1', 'pat at gmail dot com')$$,
  'For your safety, contact details can''t be shared in chat',
  'an at-dot email is rejected'
);
select throws_ok(
  $$select public.post_message('c1070000-0000-4000-8000-0000000000a1', '4045551234')$$,
  'For your safety, contact details can''t be shared in chat',
  'a bare phone number is rejected'
);
select throws_ok(
  $$select public.post_message('c1070000-0000-4000-8000-0000000000a1', 'call me at 404 555')$$,
  'For your safety, contact details can''t be shared in chat',
  'a partial phone number is rejected'
);
select throws_ok(
  $$select public.post_message('c1070000-0000-4000-8000-0000000000a1', 'pat@gmail.com')$$,
  'For your safety, contact details can''t be shared in chat',
  'a plain email is rejected'
);
select throws_ok(
  $$select public.post_message('c1070000-0000-4000-8000-0000000000a1', 'Order # 2849103756 call me at 4045551234')$$,
  'For your safety, contact details can''t be shared in chat',
  'an order number does not excuse a phone number later in the message'
);
select lives_ok(
  $$select public.post_message('c1070000-0000-4000-8000-0000000000a1', 'See you at 3. ZIP 30106. Two items.')$$,
  'ordinary words are kept'
);
select is(
  (select count(*) from public.messages where thread_id = 'c1070000-0000-4000-8000-0000000000a1' and body like '%555%')::integer,
  0,
  'a rejected number is not stored'
);
select lives_ok(
  $$select public.post_message(
    'c1070000-0000-4000-8000-0000000000a1',
    'Gate code is 4821#. code 1234. #5590. Order # 2849103756. Home Depot order WC12345678. pickup number 7731. 1985 Chattahoochee Dr, Apt 2304, Duluth 30097. $150. 72 x 36 inches. at 2:30 PM. two chairs and one table. 3rd floor.'
  )$$,
  'gate codes, order numbers, addresses, prices, sizes, and times are kept'
);
select is(
  (select count(*) from public.messages where thread_id = 'c1070000-0000-4000-8000-0000000000a1' and body like '%4821#%')::integer,
  1,
  'a gate code is stored'
);

select throws_ok(
  $$select public.register_message_file('c1070000-0000-4000-8000-0000000000a1', 'c1070000-0000-4000-8000-0000000000a1/4045551234.jpg')$$,
  'For your safety, contact details can''t be shared in chat',
  'a file name with a phone number is rejected'
);

select pg_temp.as_postgres();
set local role postgres;
set local session_replication_role = replica;
update public.jobs
set payment_status = 'authorized'
where id = 'c1070000-0000-4000-8000-000000000010';
set local session_replication_role = origin;
update public.jobs
set status = 'completed'
where id = 'c1070000-0000-4000-8000-000000000010';
select ok(
  (select closes_at <= now() from public.message_threads where id = 'c1070000-0000-4000-8000-0000000000a1'),
  'completing the job closes the chat immediately'
);
select pg_temp.as_user('c1070000-0000-4000-8000-000000000002');
select throws_ok(
  $$select public.post_message('c1070000-0000-4000-8000-0000000000a1', 'I am outside')$$,
  'this conversation is closed',
  'a completed job chat rejects a new message'
);

select pg_temp.as_postgres();
set local role postgres;
insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method
) values (
  'c1070000-0000-4000-8000-000000000011', 'c1070000-0000-4000-8000-000000000001', 'delivery', 'open',
  (select id from public.zones where slug = 'west_metro'), 'Norcross 30071', 'Duluth 30096', 'Table pickup', 1, 'medium',
  0, 0, false, false, 'asap', 'fixed'
);
set local session_replication_role = replica;
update public.jobs
set status = 'assigned', assigned_driver_id = 'c1070000-0000-4000-8000-000000000002'
where id = 'c1070000-0000-4000-8000-000000000011';
set local session_replication_role = origin;
insert into public.message_threads (id, job_id, requester_id, driver_id, kind)
values (
  'c1070000-0000-4000-8000-0000000000a2',
  'c1070000-0000-4000-8000-000000000011',
  'c1070000-0000-4000-8000-000000000001',
  'c1070000-0000-4000-8000-000000000002',
  'job'
);
select pg_temp.as_postgres();
set local role postgres;
update public.jobs set status = 'cancelled' where id = 'c1070000-0000-4000-8000-000000000011';
select ok(
  (select closes_at <= now() from public.message_threads where id = 'c1070000-0000-4000-8000-0000000000a2'),
  'cancelling the job closes the chat immediately'
);

insert into public.message_threads (id, requester_id, kind)
values (
  'c1070000-0000-4000-8000-0000000000b1',
  'c1070000-0000-4000-8000-000000000001',
  'support'
);
select pg_temp.as_user('c1070000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.post_message('c1070000-0000-4000-8000-0000000000b1', 'pat at gmail dot com')$$,
  'For your safety, contact details can''t be shared in chat',
  'a customer cannot put contact details in support chat'
);
select pg_temp.as_user('c1070000-0000-4000-8000-000000000003');
select lives_ok(
  $$select public.post_message('c1070000-0000-4000-8000-0000000000b1', 'Email me at sky@pickuply.test')$$,
  'an admin can include contact details in a support thread'
);
select pg_temp.as_postgres();
set local role postgres;
insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, dropoff_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date, pricing_method
) values (
  'c1070000-0000-4000-8000-000000000012', 'c1070000-0000-4000-8000-000000000001', 'delivery', 'open',
  (select id from public.zones where slug = 'west_metro'), 'Norcross 30071', 'Duluth 30096', 'Chair pickup', 1, 'medium',
  0, 0, false, false, 'asap', 'fixed'
);
set local session_replication_role = replica;
update public.jobs
set status = 'assigned', assigned_driver_id = 'c1070000-0000-4000-8000-000000000002'
where id = 'c1070000-0000-4000-8000-000000000012';
set local session_replication_role = origin;
insert into public.message_threads (id, job_id, requester_id, driver_id, kind)
values (
  'c1070000-0000-4000-8000-0000000000a3',
  'c1070000-0000-4000-8000-000000000012',
  'c1070000-0000-4000-8000-000000000001',
  'c1070000-0000-4000-8000-000000000002',
  'job'
);
select pg_temp.as_user('c1070000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$select public.post_message('c1070000-0000-4000-8000-0000000000a3', 'call 404-555-1212')$$,
  'For your safety, contact details can''t be shared in chat',
  'an admin cannot put contact details in a job chat'
);

select * from finish();
rollback;
