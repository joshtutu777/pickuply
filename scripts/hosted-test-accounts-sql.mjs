import { deployedTestPhones } from "./deployed-test-target.mjs";

const fixtureJobIds = [
  "c1300000-0000-4000-8000-000000000302",
  "c1300000-0000-4000-8000-000000000303",
  "c1300000-0000-4000-8000-000000000304",
  "c1300000-0000-4000-8000-000000000305",
  "c1300000-0000-4000-8000-000000000313",
];

function phoneList() {
  return deployedTestPhones.map((phone) => `'${phone}'`).join(", ");
}

function jobList() {
  return fixtureJobIds.map((id) => `'${id}'`).join(", ");
}

export function hostedRosterPrecheckSql() {
  return `
do $$
declare
  real_profiles integer;
  real_jobs integer;
begin
  select count(*) into real_profiles
  from public.profiles
  where right(regexp_replace(phone, '\\D', '', 'g'), 10) in (${phoneList()})
    and is_test is distinct from true;

  select count(*) into real_jobs
  from public.jobs
  where id in (${jobList()})
    and is_test is distinct from true;

  if real_profiles <> 0 then
    raise exception 'refusing: a roster phone belongs to a real profile';
  end if;
  if real_jobs <> 0 then
    raise exception 'refusing: a fixture job belongs to a real record';
  end if;
end $$;
`;
}

// Marks only a brand-new empty customer created after the precheck.
// A profile with a name, another role, a driver row, or any job is left alone.
export function hostedRosterClaimFreshSql() {
  return `
update public.profiles
set is_test = true
where right(regexp_replace(phone, '\\D', '', 'g'), 10) in (${phoneList()})
  and is_test = false
  and role = 'customer'
  and full_name is null
  and deleted_at is null
  and not exists (
    select 1 from public.jobs
    where customer_id = profiles.id or assigned_driver_id = profiles.id
  )
  and not exists (
    select 1 from public.drivers where profile_id = profiles.id
  )
  and not exists (
    select 1 from public.job_offers
    where driver_id = profiles.id
  )
  and not exists (
    select 1 from public.ledger_entries where driver_id = profiles.id
  );

do $$
begin
  if exists (
    select 1 from public.profiles
    where right(regexp_replace(phone, '\\D', '', 'g'), 10) in (${phoneList()})
      and is_test is distinct from true
  ) then
    raise exception 'refusing: a roster phone belongs to a real profile';
  end if;
end $$;
`;
}

export function hostedRosterCleanupSql() {
  return `
do $$
declare
  real_profiles integer;
begin
  select count(*) into real_profiles
  from public.profiles
  where right(regexp_replace(phone, '\\D', '', 'g'), 10) in (${phoneList()})
    and is_test is distinct from true;
  if real_profiles <> 0 then
    raise exception 'refusing: cleanup found a real profile on a roster phone';
  end if;
end $$;

begin;
create temporary table roster on commit drop as
select id from public.profiles
where is_test = true
  and right(regexp_replace(phone, '\\D', '', 'g'), 10) in (${phoneList()});
create temporary table roster_jobs on commit drop as
select id from public.jobs
where is_test = true
  and (
    customer_id in (select id from roster)
    or assigned_driver_id in (select id from roster)
  );
delete from public.ledger_entries where driver_id in (select id from roster) or job_id in (select id from roster_jobs);
delete from public.job_disputes where job_id in (select id from roster_jobs);
delete from public.job_reports where job_id in (select id from roster_jobs) or reporter_id in (select id from roster);
delete from public.job_reviews where job_id in (select id from roster_jobs) or reviewer_id in (select id from roster);
delete from public.notifications where profile_id in (select id from roster) or job_id in (select id from roster_jobs);
delete from public.job_events where job_id in (select id from roster_jobs);
delete from public.job_private where job_id in (select id from roster_jobs);
delete from public.job_payments where job_id in (select id from roster_jobs);
delete from public.jobs where id in (select id from roster_jobs) and is_test = true;
delete from auth.users where id in (select id from roster);
commit;
`;
}
