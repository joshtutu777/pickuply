-- Public blog posts. Drafts stay private. Images stay in a private bucket.
-- Apply locally only until a hosted migration is approved.

create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null,
  excerpt text not null default '',
  category text not null,
  body jsonb not null default '[]'::jsonb,
  cover_path text,
  cover_alt text not null default '',
  author_name text not null default '',
  seo_title text not null default '',
  seo_description text not null default '',
  status text not null default 'draft',
  published_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_posts_title_length check (char_length(btrim(title)) between 1 and 160),
  constraint blog_posts_slug_shape check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 1 and 80),
  constraint blog_posts_excerpt_length check (char_length(excerpt) <= 300),
  constraint blog_posts_category check (
    category in (
      'moving-tips',
      'facebook-marketplace',
      'furniture-delivery',
      'for-drivers',
      'pickup-delivery-guides',
      'pickuply-updates'
    )
  ),
  constraint blog_posts_cover_alt_length check (char_length(cover_alt) <= 180),
  constraint blog_posts_author_length check (char_length(author_name) <= 80),
  constraint blog_posts_seo_title_length check (char_length(seo_title) <= 70),
  constraint blog_posts_seo_description_length check (char_length(seo_description) <= 180),
  constraint blog_posts_status check (status in ('draft', 'published')),
  constraint blog_posts_slug_key unique (slug)
);

create index blog_posts_published_idx on public.blog_posts (published_at desc) where status = 'published';

create or replace function public.touch_blog_post()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

create trigger blog_posts_touch
  before insert or update on public.blog_posts
  for each row execute function public.touch_blog_post();

create or replace function public.blog_image_is_public(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.blog_posts
    where status = 'published'
      and (
        cover_path = object_name
        or exists (
          select 1
          from jsonb_array_elements(body) as block
          where block->>'type' = 'image'
            and block->>'path' = object_name
        )
      )
  );
$$;

revoke all on function public.touch_blog_post() from public, anon, authenticated, service_role;
revoke all on function public.blog_image_is_public(text) from public, anon, authenticated, service_role;
grant execute on function public.blog_image_is_public(text) to anon, authenticated, service_role;

alter table public.blog_posts enable row level security;

create policy blog_posts_public_read on public.blog_posts
  for select
  to anon, authenticated
  using (status = 'published' or public.is_admin());

create policy blog_posts_admin_insert on public.blog_posts
  for insert
  to authenticated
  with check (public.is_admin());

create policy blog_posts_admin_update on public.blog_posts
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy blog_posts_admin_delete on public.blog_posts
  for delete
  to authenticated
  using (public.is_admin());

grant select on public.blog_posts to anon, authenticated;
grant insert, update, delete on public.blog_posts to authenticated;

insert into storage.buckets (id, name, public)
values ('blog-images', 'blog-images', false)
on conflict (id) do update set public = false;

do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'blog_images_read'
  ) then
    create policy blog_images_read
      on storage.objects
      for select
      to anon, authenticated
      using (
        bucket_id = 'blog-images'
        and (public.is_admin() or public.blog_image_is_public(name))
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'blog_images_admin_insert'
  ) then
    create policy blog_images_admin_insert
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'blog-images'
        and public.is_admin()
        and name ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.(jpg|jpeg|png|webp)$'
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'blog_images_admin_delete'
  ) then
    create policy blog_images_admin_delete
      on storage.objects
      for delete
      to authenticated
      using (bucket_id = 'blog-images' and public.is_admin());
  end if;
end;
$policy$;
