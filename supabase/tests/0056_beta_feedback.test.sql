-- Local Supabase only. Feedback is the signed-in person's own row. Notes stay with admin.

begin;

select plan(19);

do $$
declare
  sch text;
begin
  for sch in
    select n.nspname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'ok'
  loop
    execute format('grant usage on schema %I to anon, authenticated, service_role', sch);
    execute format(
      'grant execute on all functions in schema %I to anon, authenticated, service_role',
      sch
    );
  end loop;
end $$;

create or replace function pg_temp.as_user(uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

create or replace function pg_temp.make_user(uid uuid, email text)
returns void
language plpgsql
as $$
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

select pg_temp.make_user('c1560000-0000-4000-8000-000000000001', 'feedback-customer@pickuply.test');
select pg_temp.make_user('c1560000-0000-4000-8000-000000000002', 'feedback-other@pickuply.test');
select pg_temp.make_user('c1560000-0000-4000-8000-000000000003', 'feedback-admin@pickuply.test');
select pg_temp.make_user('c1560000-0000-4000-8000-000000000004', 'feedback-driver@pickuply.test');

update public.profiles set role = 'admin', full_name = 'Feedback Admin' where id = 'c1560000-0000-4000-8000-000000000003';
update public.profiles set role = 'driver', full_name = 'Feedback Driver' where id = 'c1560000-0000-4000-8000-000000000004';
update public.profiles set full_name = 'Feedback Customer' where id = 'c1560000-0000-4000-8000-000000000001';

select pg_temp.as_user('c1560000-0000-4000-8000-000000000001');
set local role authenticated;

select lives_ok(
  $$select public.submit_beta_feedback('bug', 'Map pin', 'The pin stayed on the old area after I changed ZIP.', 'https://evil.example', 'beta', 'Mozilla/5.0')$$,
  'a customer can submit feedback'
);

select results_eq(
  $$select user_id::text, user_role, status, page_path, attachment_path
    from public.beta_feedback
    where user_id = 'c1560000-0000-4000-8000-000000000001'
      and subject = 'Map pin'$$,
  $$values (
    'c1560000-0000-4000-8000-000000000001',
    'customer',
    'new',
    '/feedback',
    null::text
  )$$,
  'the row belongs to the caller, starts new, and drops an unsafe page'
);

select throws_ok(
  $$select public.submit_beta_feedback('bug', 'Map pin', 'The pin stayed on the old area after I changed ZIP.', '/account', 'beta', null)$$,
  'You already sent this feedback.',
  'the same report cannot be sent twice in a short window'
);

select throws_ok(
  $$select public.submit_beta_feedback('phone', 'Map pin', 'The pin stayed on the old area after I changed ZIP.', '/account', 'beta', null)$$,
  'Choose a feedback type.',
  'an unknown type is rejected'
);

select is(
  (select count(*) from public.beta_feedback where user_id = 'c1560000-0000-4000-8000-000000000002'),
  0::bigint,
  'another customer has no feedback rows yet'
);

select pg_temp.as_user('c1560000-0000-4000-8000-000000000002');

select is(
  (select count(*) from public.beta_feedback),
  0::bigint,
  'another customer cannot read the first report'
);

select throws_ok(
  $$insert into public.beta_feedback (user_id, user_role, feedback_type, subject, description, page_path)
    values (auth.uid(), 'customer', 'bug', 'Direct', 'This should not insert at all.', '/account')$$,
  '42501',
  'permission denied for table beta_feedback',
  'direct insert is denied'
);

select throws_ok(
  $$update public.beta_feedback set status = 'resolved'$$,
  '42501',
  'permission denied for table beta_feedback',
  'a customer cannot change status directly'
);

select is(
  (select count(*) from public.beta_feedback_notes),
  0::bigint,
  'a customer cannot read admin notes'
);

select throws_ok(
  $$select public.review_beta_feedback('c1560000-0000-4000-8000-000000000099', 'resolved', 'secret')$$,
  'only an admin can review feedback',
  'a customer cannot review feedback'
);

select throws_ok(
  $$select public.list_beta_feedback(null, null, null, null, null, null, 20, 0)$$,
  'only an admin can read feedback',
  'a customer cannot list every report'
);

select pg_temp.as_user('c1560000-0000-4000-8000-000000000004');

select lives_ok(
  $$select public.submit_beta_feedback('feature', 'Job alert', 'Please group nearby jobs on the driver home screen.', '/driver', 'beta', 'Mobile')$$,
  'a driver can submit feedback'
);

select is(
  (select user_role from public.beta_feedback where subject = 'Job alert'),
  'driver',
  'the stored role comes from the profile'
);

select pg_temp.as_user('c1560000-0000-4000-8000-000000000003');

select lives_ok(
  $$select public.review_beta_feedback(
    (select id from public.beta_feedback where subject = 'Map pin'),
    'under_review',
    'Look at the ZIP picker.'
  )$$,
  'an admin can set status and a private note'
);

select is(
  (select body from public.beta_feedback_notes),
  'Look at the ZIP picker.',
  'an admin can read the note'
);

select pg_temp.as_user('c1560000-0000-4000-8000-000000000001');

select is(
  (select count(*) from public.beta_feedback_notes),
  0::bigint,
  'the author still cannot read the note'
);

select pg_temp.as_user('c1560000-0000-4000-8000-000000000003');

select results_eq(
  $$select total_count, new_count, under_review_count from public.beta_feedback_counts()$$,
  $$values (2::bigint, 1::bigint, 1::bigint)$$,
  'counts separate new and under review'
);

select is(
  (select subject from public.list_beta_feedback(null, null, null, null, null, 'Map', 20, 0) limit 1),
  'Map pin',
  'an admin search finds the report by subject'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select throws_ok(
  $$select count(*) from public.beta_feedback$$,
  '42501',
  'permission denied for table beta_feedback',
  'anonymous visitors cannot read feedback'
);

select * from finish();
rollback;
