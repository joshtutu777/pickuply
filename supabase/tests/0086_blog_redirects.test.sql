-- A published article's old address stays readable. A draft's old address does not.

begin;

select plan(3);

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

select pg_temp.make_user('c1860000-0000-4000-8000-000000000001', 'blog-redirect-customer@pickuply.test');

insert into public.blog_posts (title, slug, category, status, previous_slugs)
values ('Moved guide', 'moved-guide', 'moving-tips', 'published', array['old-guide']);

insert into public.blog_posts (title, slug, category, status, previous_slugs)
values ('Hidden guide', 'hidden-guide', 'moving-tips', 'draft', array['secret-guide']);

set local role anon;
select results_eq(
  $$select slug from public.blog_posts where 'old-guide' = any(previous_slugs)$$,
  $$values ('moved-guide')$$,
  'visitors can resolve a published article from its old address'
);
select is_empty(
  $$select slug from public.blog_posts where 'secret-guide' = any(previous_slugs)$$,
  'visitors cannot resolve a draft from an old address'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1860000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"c1860000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is_empty(
  $$update public.blog_posts set title = 'Nope' where slug = 'moved-guide' returning slug$$,
  'a customer cannot edit an article'
);

select * from finish();
rollback;
