-- Every customer request is posted for driver offers. An admin price is not required.
-- All Georgia Requests lists every eligible open request, including ones that also match the driver's areas.
-- Existing rows that were still waiting on an admin are opened here. Prices and payments are not changed.

do $open_requests$
declare
  src text;
  next text;
  fn text;
begin
  foreach fn in array array[
    'public.driver_georgia_page(integer, integer, text, text, integer, text, boolean)',
    'public.driver_georgia_count(text, integer, text, boolean)'
  ]
  loop
    src := replace(pg_get_functiondef(fn::regprocedure), chr(13), '');
    next := replace(src, 'where not rows.matched', 'where true');
    if next = src then
      raise exception 'All Georgia still hides matched requests in %', fn;
    end if;
    execute next;
  end loop;

  foreach fn in array array[
    'public.answer_detail_request(uuid, jsonb, text)',
    'public.messages_return_detail_request()'
  ]
  loop
    src := replace(pg_get_functiondef(fn::regprocedure), chr(13), '');
    next := replace(
      src,
      E'status = case when pricing_method = ''quote'' and status is distinct from ''open'' then ''requested''::public.job_status else ''open''::public.job_status end',
      'status = ''open'''
    );
    if next = src then
      raise exception 'quote requests would still return to requested in %', fn;
    end if;
    execute next;
  end loop;
end
$open_requests$;

update public.jobs
set status = 'open'
where status in ('requested', 'in_review')
  and test_retired_at is null
  and paused_at is null;
