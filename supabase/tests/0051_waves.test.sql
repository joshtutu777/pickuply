-- Local only. Waves stay off, and a driver cannot turn them on.

begin;

select plan(3);

select ok(not public.waves_enabled(), 'waves start off');

select throws_ok(
  $$select public.set_waves_enabled(true)$$,
  'only an admin can change settings',
  'a signed-out session cannot turn waves on'
);

select is(
  (
    select column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'drivers'
      and column_name = 'offline_job_alerts'
  ),
  'true',
  'job alerts while offline start on'
);

select * from finish();
rollback;
