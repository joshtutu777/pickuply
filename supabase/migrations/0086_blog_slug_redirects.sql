-- Old published addresses keep working after an admin changes the slug.
-- Apply locally only until a hosted migration is approved.

alter table public.blog_posts
  add column if not exists previous_slugs text[] not null default '{}';

create or replace function public.blog_slug_is_free()
returns trigger
language plpgsql
as $$
begin
  if cardinality(new.previous_slugs) > 20
    or exists (
      select 1
      from unnest(new.previous_slugs) as old_slug
      where old_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
        or char_length(old_slug) > 80
        or old_slug = new.slug
    )
  then
    raise exception 'That address is not valid.';
  end if;
  if exists (
    select 1
    from public.blog_posts
    where id is distinct from new.id
      and (
        slug = new.slug
        or new.slug = any(previous_slugs)
        or slug = any(new.previous_slugs)
        or previous_slugs && new.previous_slugs
      )
  ) then
    raise exception 'That address is already used.' using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke all on function public.blog_slug_is_free() from public, anon, authenticated, service_role;

drop trigger if exists blog_posts_slug_free on public.blog_posts;
create trigger blog_posts_slug_free
  before insert or update of slug, previous_slugs on public.blog_posts
  for each row execute function public.blog_slug_is_free();
