-- Login and the request form use the same phone and network buckets.

begin;

select plan(7);

select lives_ok(
  $$
    do $body$
    declare
      sent integer;
    begin
      for sent in 1..5 loop
        perform public.consume_rate_limit(
          'otp-phone',
          'shared-phone',
          5,
          3600,
          'Too many codes for this number. Try again in an hour.'
        );
      end loop;
    end
    $body$;
  $$,
  'five login and request sends share one phone bucket'
);

select throws_ok(
  $$select public.consume_rate_limit('otp-phone', 'shared-phone', 5, 3600, 'Too many codes for this number. Try again in an hour.')$$,
  'Too many codes for this number. Try again in an hour.',
  'the sixth send is refused with a sentence that has no phone number'
);

select is(
  (select count(*)::integer from public.rate_limit_events where scope = 'otp-phone' and actor_key = 'shared-phone'),
  5,
  'a refused send does not add another phone count'
);

select lives_ok(
  $$select public.consume_rate_limit('otp-phone', 'other-phone', 5, 3600, 'Too many codes for this number. Try again in an hour.')$$,
  'a different phone still has its own bucket'
);

select lives_ok(
  $$
    do $body$
    declare
      sent integer;
    begin
      for sent in 1..10 loop
        perform public.consume_rate_limit(
          'otp-ip',
          'shared-network',
          10,
          3600,
          'Too many codes from this network. Try again in an hour.'
        );
      end loop;
    end
    $body$;
  $$,
  'ten sends from one network are allowed'
);

select throws_ok(
  $$select public.consume_rate_limit('otp-ip', 'shared-network', 10, 3600, 'Too many codes from this network. Try again in an hour.')$$,
  'Too many codes from this network. Try again in an hour.',
  'the eleventh send from that network is refused'
);

set local role anon;

select throws_ok(
  $$select public.consume_rate_limit('otp-phone', 'direct', 5, 3600, 'hidden')$$,
  '42501',
  'permission denied for function consume_rate_limit',
  'a direct request cannot record its own code limit'
);

select * from finish();
rollback;
