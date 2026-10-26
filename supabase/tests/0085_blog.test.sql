-- Local only. Draft articles and their images stay off the public site.

begin;

select plan(10);

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

create or replace function pg_temp.as_user(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.clear_auth()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
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

select pg_temp.make_user('c1850000-0000-4000-8000-000000000001', 'blog-customer@pickuply.test');
select pg_temp.make_user('c1850000-0000-4000-8000-000000000002', 'blog-admin@pickuply.test');
update public.profiles set role = 'admin' where id = 'c1850000-0000-4000-8000-000000000002';

insert into public.blog_posts (id, title, slug, excerpt, category, status, created_by)
values (
  'c1850000-0000-4000-8000-000000000010',
  'Draft guide',
  'draft-guide',
  'Not public',
  'moving-tips',
  'draft',
  'c1850000-0000-4000-8000-000000000002'
);

insert into public.blog_posts (id, title, slug, excerpt, category, body, cover_path, status, created_by)
values (
  'c1850000-0000-4000-8000-000000000011',
  'Published guide',
  'published-guide',
  'Public',
  'for-drivers',
  '[{"type":"image","path":"c1850000-0000-4000-8000-000000000011/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png","alt":"Couch"}]'::jsonb,
  'c1850000-0000-4000-8000-000000000011/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png',
  'published',
  'c1850000-0000-4000-8000-000000000002'
);

insert into storage.objects (bucket_id, name, owner_id) values
  ('blog-images', 'c1850000-0000-4000-8000-000000000011/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png', 'c1850000-0000-4000-8000-000000000002'),
  ('blog-images', 'c1850000-0000-4000-8000-000000000010/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png', 'c1850000-0000-4000-8000-000000000002');

select ok(public.blog_image_is_public('c1850000-0000-4000-8000-000000000011/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png'), 'a published cover is public');
select ok(not public.blog_image_is_public('c1850000-0000-4000-8000-000000000010/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png'), 'a draft image stays private');
select ok((select published_at is not null from public.blog_posts where slug = 'published-guide'), 'publishing records the time');
select ok((select published_at is null from public.blog_posts where slug = 'draft-guide'), 'a draft has no publication date');

select pg_temp.clear_auth();
set local role anon;
select results_eq(
  $$select slug from public.blog_posts order by slug$$,
  $$values ('published-guide')$$,
  'anonymous visitors see only published articles'
);
select is(
  (select count(*)::int from storage.objects where name like 'c1850000-0000-4000-8000-000000000010/%'),
  0,
  'anonymous visitors cannot read a draft image'
);

reset role;
select pg_temp.as_user('c1850000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$insert into public.blog_posts (title, slug, category) values ('Nope', 'nope', 'moving-tips')$$,
  '42501',
  'new row violates row-level security policy for table "blog_posts"',
  'a customer cannot create an article'
);

reset role;
select pg_temp.as_user('c1850000-0000-4000-8000-000000000002');
set local role authenticated;
select lives_ok(
  $$insert into public.blog_posts (title, slug, category, created_by) values ('Admin note', 'admin-note', 'pickuply-updates', 'c1850000-0000-4000-8000-000000000002')$$,
  'an admin can create a draft'
);
select throws_ok(
  $$insert into public.blog_posts (title, slug, category) values ('Again', 'published-guide', 'moving-tips')$$,
  '23505',
  'duplicate key value violates unique constraint "blog_posts_slug_key"',
  'slugs stay unique'
);
select is(
  (select count(*)::int from public.blog_posts where slug = 'draft-guide'),
  1,
  'an admin can still read a draft'
);

select * from finish();
rollback;
