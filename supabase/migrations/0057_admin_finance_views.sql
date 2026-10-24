-- Saved finance filters belong to the signed-in admin. Local until the owner applies it.

create table public.admin_finance_views (
  admin_id uuid primary key references public.profiles (id) on delete cascade,
  query text not null check (char_length(query) between 0 and 4000),
  updated_at timestamptz not null default now()
);

alter table public.admin_finance_views enable row level security;

create policy admin_finance_views_own on public.admin_finance_views
  for all
  to authenticated
  using (admin_id = auth.uid() and public.is_admin())
  with check (admin_id = auth.uid() and public.is_admin());

revoke all on public.admin_finance_views from public, anon, authenticated;
grant select, insert, update, delete on public.admin_finance_views to authenticated;
