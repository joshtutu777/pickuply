-- Replaces the old hourly 5-per-phone and 10-per-network assertions.
-- consume_rate_limit stays, because the deployed app still calls it until this pull request is deployed.

begin;

select plan(8);

select lives_ok(
  $$
    do $body$
    declare
      sent integer;
    begin
      for sent in 1..12 loop
        perform public.reserve_otp_send(repeat(sent::text, 16), repeat('9', 64));
      end loop;
    end
    $body$;
  $$,
  'twelve different numbers on one network can each request a code'
);

select throws_ok(
  $$
    do $body$
    declare
      sent integer;
    begin
      for sent in 1..16 loop
        perform public.reserve_otp_send(repeat(chr(64 + sent), 16), repeat('8', 64));
      end loop;
    end
    $body$;
  $$,
  'Too many new numbers from this network right now. Try again in a few minutes.',
  'the sixteenth new number from that network is refused'
);

select lives_ok(
  $$select public.reserve_otp_send(repeat('a', 64), repeat('b', 64))$$,
  'one number can request a code'
);

select throws_ok(
  $$select public.reserve_otp_send(repeat('a', 64), repeat('b', 64))$$,
  'Wait 30 seconds before requesting another code.',
  'the same number has to wait 30 seconds'
);

select is(
  (select count(*)::integer from public.otp_send_log where phone_key = repeat('a', 64)),
  1,
  'a refused send does not add another row'
);

select lives_ok(
  $$
    do $body$
    begin
      update public.otp_send_log
      set created_at = now() - interval '31 seconds'
      where phone_key = repeat('a', 64);
      perform public.reserve_otp_send(repeat('a', 64), repeat('b', 64));
    end
    $body$;
  $$,
  'the same number can request another code after 30 seconds'
);

select has_function(
  'public',
  'consume_rate_limit',
  array['text', 'text', 'integer', 'integer', 'text'],
  'the deployed sign-in limit function is still there'
);

set local role anon;

select throws_ok(
  $$select public.reserve_otp_send(repeat('c', 64), repeat('d', 64))$$,
  '42501',
  'permission denied for function reserve_otp_send',
  'a direct request cannot record its own code limit'
);

select * from finish();
rollback;
