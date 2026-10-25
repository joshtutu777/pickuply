begin;
select plan(3);

select is(
  (select center_lat::numeric from public.zones where slug = 'west_metro'),
  33.8369::numeric,
  'West Metro fallback is Austell'
);

select is(public.round_half_mile(12.2), 12::numeric, 'half mile rounds down');
select is(public.round_half_mile(12.3), 12.5::numeric, 'half mile rounds up');

select * from finish();
rollback;
