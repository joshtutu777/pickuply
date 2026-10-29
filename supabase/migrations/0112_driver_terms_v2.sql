-- Drivers who accepted driver-terms-v1 must accept driver-terms-v2
-- before they can go Online. Do not apply this until the app that
-- checks driver-terms-v2 is deployed in the same release.

do $migrate$
declare
  def text;
  fn text;
begin
  foreach fn in array array[
    'public.accept_driver_terms()',
    'public.set_driver_online(go_online boolean)',
    'public.submit_quick_application(payload jsonb)'
  ]
  loop
    def := pg_get_functiondef(fn::regprocedure);
    if position('driver-terms-v1' in def) = 0 then
      raise exception 'expected driver-terms-v1 in %', fn;
    end if;
    execute replace(def, 'driver-terms-v1', 'driver-terms-v2');
  end loop;
end
$migrate$;
