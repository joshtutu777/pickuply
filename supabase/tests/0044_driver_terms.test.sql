begin;
select plan(2);

select throws_ok(
  $$select public.submit_quick_application('{}'::jsonb)$$,
  'sign in required',
  'terms cannot be saved without a signed-in driver'
);

select has_column('public', 'drivers', 'terms_version', 'driver terms version is stored');

select * from finish();
rollback;
