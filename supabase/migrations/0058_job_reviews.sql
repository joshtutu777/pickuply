-- Two-sided reviews after a completed job. Local until the owner applies it.
-- A review stays hidden from the other person until both have reviewed
-- or 14 days have passed since completion. Admins can hide a review.
-- They cannot change the stars or the words.

create table public.job_reviews (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id),
  reviewee_id uuid not null references public.profiles (id),
  reviewer_role text not null,
  stars integer not null,
  body text,
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint job_reviews_role check (reviewer_role in ('customer', 'driver')),
  constraint job_reviews_stars check (stars between 1 and 5),
  constraint job_reviews_body check (body is null or char_length(body) between 1 and 1000),
  constraint job_reviews_not_self check (reviewer_id <> reviewee_id),
  constraint job_reviews_once unique (job_id, reviewer_id)
);

alter table public.job_reviews enable row level security;

create or replace function public.job_completed_at(target_job uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select min(created_at)
      from public.job_events
      where job_id = target_job
        and type = 'status'
        and data->>'to' = 'completed'
    ),
    (select customer_confirmed_at from public.jobs where id = target_job),
    (select updated_at from public.jobs where id = target_job)
  );
$$;

create or replace function public.review_is_published(target_job uuid, submitted_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    select count(*) from public.job_reviews where job_id = target_job
  ) >= 2
  or coalesce(public.job_completed_at(target_job), submitted_at) <= now() - interval '14 days';
$$;

create or replace function public.can_read_review(target_review uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  row public.job_reviews%rowtype;
begin
  if auth.uid() is null then
    return false;
  end if;
  select * into row from public.job_reviews where id = target_review;
  if not found then
    return false;
  end if;
  if public.is_admin() or row.reviewer_id = auth.uid() then
    return true;
  end if;
  if row.hidden_at is not null then
    return false;
  end if;
  return row.reviewee_id = auth.uid()
    and public.review_is_published(row.job_id, row.created_at);
end;
$$;

create policy job_reviews_select on public.job_reviews
  for select to authenticated
  using (public.can_read_review(id));

revoke all on table public.job_reviews from public, anon, authenticated, service_role;
grant select on table public.job_reviews to authenticated;

revoke all on function public.job_completed_at(uuid) from public, anon, authenticated, service_role;
revoke all on function public.review_is_published(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.can_read_review(uuid) from public, anon, authenticated, service_role;
grant execute on function public.can_read_review(uuid) to authenticated;

create or replace function public.submit_job_review(
  target_job uuid,
  star_count integer,
  note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  role_name text;
  other uuid;
  clean text := nullif(btrim(coalesce(note, '')), '');
  review_id uuid;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if star_count is null or star_count < 1 or star_count > 5 then
    raise exception 'choose 1 to 5 stars';
  end if;
  if clean is not null and char_length(clean) > 1000 then
    raise exception 'keep the review under 1000 characters';
  end if;
  select * into job_row from public.jobs where id = target_job;
  if not found or job_row.status <> 'completed' then
    raise exception 'reviews are only for completed jobs';
  end if;
  if job_row.customer_id = job_row.assigned_driver_id or job_row.assigned_driver_id is null then
    raise exception 'you cannot review yourself';
  end if;
  if uid = job_row.customer_id then
    role_name := 'customer';
    other := job_row.assigned_driver_id;
  elsif uid = job_row.assigned_driver_id then
    role_name := 'driver';
    other := job_row.customer_id;
  else
    raise exception 'only the customer and the assigned driver can review';
  end if;
  if uid = other then
    raise exception 'you cannot review yourself';
  end if;
  insert into public.job_reviews (job_id, reviewer_id, reviewee_id, reviewer_role, stars, body)
  values (target_job, uid, other, role_name, star_count, clean)
  returning id into review_id;

  if (select count(*) from public.job_reviews where job_id = target_job) >= 2 then
    perform public.enqueue_notification(
      job_row.customer_id, target_job, 'review_published',
      'Reviews are visible',
      'Both reviews for this job can now be read.',
      '/jobs/' || target_job::text,
      'review-published:' || target_job::text
    );
    perform public.enqueue_notification(
      job_row.assigned_driver_id, target_job, 'review_published',
      'Reviews are visible',
      'Both reviews for this job can now be read.',
      '/driver/jobs/' || target_job::text,
      'review-published:' || target_job::text || ':driver'
    );
  end if;
  return review_id;
end;
$$;

create or replace function public.hide_job_review(target_review uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.job_reviews%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can hide a review';
  end if;
  select * into row from public.job_reviews where id = target_review;
  if not found then
    raise exception 'review not found';
  end if;
  update public.job_reviews
  set hidden_at = coalesce(hidden_at, now()),
      hidden_by = coalesce(hidden_by, auth.uid())
  where id = target_review;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    'hide_job_review',
    'job_review',
    target_review,
    jsonb_build_object('job_id', row.job_id, 'stars', row.stars)
  );
end;
$$;

create or replace function public.note_review_windows()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row record;
begin
  for job_row in
    select distinct reviews.job_id, jobs.customer_id, jobs.assigned_driver_id
    from public.job_reviews reviews
    join public.jobs on jobs.id = reviews.job_id
    where reviews.hidden_at is null
      and public.job_completed_at(reviews.job_id) <= now() - interval '14 days'
      and (
        select count(*) from public.job_reviews inner_reviews
        where inner_reviews.job_id = reviews.job_id
      ) = 1
  loop
    perform public.enqueue_notification(
      job_row.customer_id, job_row.job_id, 'review_published',
      'A review is visible',
      'The 14-day review window closed.',
      '/jobs/' || job_row.job_id::text,
      'review-window:' || job_row.job_id::text
    );
    if job_row.assigned_driver_id is not null then
      perform public.enqueue_notification(
        job_row.assigned_driver_id, job_row.job_id, 'review_published',
        'A review is visible',
        'The 14-day review window closed.',
        '/driver/jobs/' || job_row.job_id::text,
        'review-window:' || job_row.job_id::text || ':driver'
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.submit_job_review(uuid, integer, text) from public, anon, service_role;
revoke all on function public.hide_job_review(uuid) from public, anon, service_role;
revoke all on function public.note_review_windows() from public, anon, authenticated, service_role;
grant execute on function public.submit_job_review(uuid, integer, text) to authenticated;
grant execute on function public.hide_job_review(uuid) to authenticated;
grant execute on function public.note_review_windows() to service_role;

drop function public.offer_summaries(uuid);

create function public.offer_summaries(target_job uuid)
returns table (
  offer_id uuid,
  driver_first_name text,
  vehicle_label text,
  jobs_completed integer,
  reason text,
  outside_range boolean,
  customer_total_cents integer,
  driver_earnings_cents integer,
  platform_fee_cents integer,
  service_fee_cents integer,
  status public.offer_status,
  expires_at timestamptz,
  viewed boolean,
  rating_avg numeric,
  review_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if not exists (
    select 1 from public.jobs
    where id = target_job and (customer_id = auth.uid() or public.is_admin())
  ) then
    return;
  end if;

  return query
  select
    offers.id,
    split_part(coalesce(profiles.full_name, 'Driver'), ' ', 1),
    trim(both ' ' from coalesce(vehicles.type::text, '') || ' ' || coalesce(vehicles.make, '')),
    (
      select count(*)::integer
      from public.jobs finished
      where finished.assigned_driver_id = offers.driver_id
        and finished.status = 'completed'
    ),
    offers.reason,
    offers.outside_range,
    offers.customer_total_cents,
    offers.driver_amount_cents,
    offers.platform_fee_cents,
    offers.service_fee_cents,
    offers.status,
    offers.expires_at,
    exists (
      select 1 from public.offer_views
      where offer_views.offer_id = offers.id
    ),
    (
      select round(avg(reviews.stars)::numeric, 1)
      from public.job_reviews reviews
      where reviews.reviewee_id = offers.driver_id
        and reviews.reviewer_role = 'customer'
        and reviews.hidden_at is null
        and public.review_is_published(reviews.job_id, reviews.created_at)
    ),
    (
      select count(*)::integer
      from public.job_reviews reviews
      where reviews.reviewee_id = offers.driver_id
        and reviews.reviewer_role = 'customer'
        and reviews.hidden_at is null
        and public.review_is_published(reviews.job_id, reviews.created_at)
    )
  from public.job_offers offers
  join public.profiles on profiles.id = offers.driver_id
  join public.drivers on drivers.profile_id = offers.driver_id
  left join lateral (
    select type, make
    from public.vehicles
    where driver_id = offers.driver_id
    order by approved desc, created_at desc
    limit 1
  ) vehicles on true
  where offers.job_id = target_job
    and offers.status = 'active'
    and offers.expires_at > now();
end;
$$;

revoke all on function public.offer_summaries(uuid) from public, anon, service_role;
grant execute on function public.offer_summaries(uuid) to authenticated;
