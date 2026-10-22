-- Save a customer request as the signed-in user.
-- Do not apply this file to the hosted project until the owner approves.
-- create_customer_request runs with the caller's rights. customer_id is always auth.uid().
-- A retry with the same id returns that id and does not update the saved rows.
-- A retry with different details is rejected and also does not update anything.
-- Row level security hides another customer's job, so a tiny definer helper only
-- answers absent, own, or other. It does not return any request fields.

create or replace function public.request_id_visibility(target uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when target is null then 'absent'
    when not exists (select 1 from public.jobs where id = target) then 'absent'
    when exists (
      select 1 from public.jobs
      where id = target and customer_id = auth.uid()
    ) then 'own'
    else 'other'
  end;
$$;

comment on function public.request_id_visibility(uuid) is
  'Says whether a request id is absent, owned by auth.uid(), or someone else. Returns no job fields.';

revoke all on function public.request_id_visibility(uuid) from public;
revoke all on function public.request_id_visibility(uuid) from anon;
revoke all on function public.request_id_visibility(uuid) from service_role;
grant execute on function public.request_id_visibility(uuid) to authenticated;

create or replace function public.create_customer_request(
  request_id uuid,
  payload jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  allowed text[] := array[
    'service', 'description', 'pieces', 'size', 'item_value_cents',
    'listing_url', 'already_paid', 'seller_holding', 'wants_item_check',
    'stairs_pickup', 'stairs_dropoff', 'elevator', 'help_loading',
    'junk_load_size', 'junk_materials', 'junk_special_items',
    'store_name', 'store_order_number', 'preferred_date', 'time_window',
    'notes', 'pricing_method', 'offer_cents', 'budget_min_cents',
    'budget_max_cents', 'source', 'zone_slug', 'pickup_area', 'dropoff_area',
    'pickup_address', 'dropoff_address', 'customer_name', 'customer_phone',
    'customer_email', 'access_notes'
  ];
  extra text;
  service_value public.job_service;
  size_value public.item_size;
  load_value public.junk_load_size;
  window_value public.time_window;
  pricing_value public.pricing_method;
  zone_value uuid;
  pieces_value integer;
  item_value integer;
  stairs_pickup_value integer;
  stairs_dropoff_value integer;
  offer_value integer;
  budget_min_value integer;
  budget_max_value integer;
  elevator_value boolean;
  help_value boolean;
  paid_value boolean;
  holding_value boolean;
  check_value boolean;
  needs_approval boolean;
  special_value jsonb;
  description_value text;
  listing_value text;
  materials_value text;
  store_name_value text;
  store_order_value text;
  preferred_value text;
  notes_value text;
  source_value text;
  pickup_area_value text;
  dropoff_area_value text;
  pickup_address_value text;
  dropoff_address_value text;
  customer_name_value text;
  customer_phone_value text;
  customer_email_value text;
  access_notes_value text;
  same_request boolean;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if request_id is null then
    raise exception 'request id is required';
  end if;
  if payload is null or jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'request details are required';
  end if;

  select k into extra
  from jsonb_object_keys(payload) as k
  where k <> all (allowed)
  limit 1;
  if extra is not null then
    raise exception 'unexpected field';
  end if;

  begin
    service_value := (payload->>'service')::public.job_service;
    size_value := (payload->>'size')::public.item_size;
    pricing_value := (payload->>'pricing_method')::public.pricing_method;
  exception
    when invalid_text_representation then
      raise exception 'service, size, or pricing method is not valid';
  end;

  if service_value is null or size_value is null or pricing_value is null then
    raise exception 'service, size, and pricing method are required';
  end if;

  if coalesce(payload->>'pieces', '') !~ '^[0-9]+$' then
    raise exception 'pieces must be a whole number';
  end if;
  pieces_value := (payload->>'pieces')::integer;
  if pieces_value < 1 or pieces_value > 100 then
    raise exception 'pieces must be from 1 to 100';
  end if;

  if coalesce(payload->>'item_value_cents', '') !~ '^[0-9]+$' then
    raise exception 'item value must be a whole number of cents';
  end if;
  item_value := (payload->>'item_value_cents')::integer;
  if item_value > 100000000 then
    raise exception 'item value is too large';
  end if;
  needs_approval := item_value > 100000;

  if coalesce(payload->>'stairs_pickup', '') !~ '^[0-3]$' then
    raise exception 'stairs at pickup must be 0 to 3';
  end if;
  stairs_pickup_value := (payload->>'stairs_pickup')::integer;

  if jsonb_typeof(payload->'elevator') is distinct from 'boolean'
    or jsonb_typeof(payload->'help_loading') is distinct from 'boolean' then
    raise exception 'elevator and help loading must be yes or no';
  end if;
  elevator_value := (payload->>'elevator')::boolean;
  help_value := (payload->>'help_loading')::boolean;

  description_value := btrim(coalesce(payload->>'description', ''));
  pickup_area_value := btrim(coalesce(payload->>'pickup_area', ''));
  pickup_address_value := btrim(coalesce(payload->>'pickup_address', ''));
  customer_name_value := btrim(coalesce(payload->>'customer_name', ''));
  customer_phone_value := btrim(coalesce(payload->>'customer_phone', ''));
  preferred_value := btrim(coalesce(payload->>'preferred_date', ''));
  source_value := btrim(coalesce(payload->>'source', ''));

  if char_length(description_value) < 1 or char_length(description_value) > 2000 then
    raise exception 'description must be 1 to 2000 characters';
  end if;
  if char_length(pickup_area_value) < 1 or char_length(pickup_area_value) > 80
    or pickup_area_value ~ '[[:cntrl:]]' then
    raise exception 'pickup area is not valid';
  end if;
  if char_length(pickup_address_value) < 1 or char_length(pickup_address_value) > 200 then
    raise exception 'pickup address is required';
  end if;
  if char_length(customer_name_value) < 1 or char_length(customer_name_value) > 120 then
    raise exception 'customer name is required';
  end if;
  if customer_phone_value !~ '^\+1[0-9]{10}$' then
    raise exception 'customer phone must be a US number';
  end if;
  if source_value not in ('nextdoor', 'facebook', 'friend', 'landlord', 'other') then
    raise exception 'source is not valid';
  end if;
  if preferred_value not in ('asap', 'today') and preferred_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'preferred date is not valid';
  end if;

  listing_value := nullif(btrim(coalesce(payload->>'listing_url', '')), '');
  if listing_value is not null and (
    char_length(listing_value) > 500
    or listing_value !~ '^https?://'
  ) then
    raise exception 'listing link must start with http:// or https://';
  end if;

  notes_value := nullif(btrim(coalesce(payload->>'notes', '')), '');
  if notes_value is not null and char_length(notes_value) > 2000 then
    raise exception 'notes are too long';
  end if;

  access_notes_value := nullif(btrim(coalesce(payload->>'access_notes', '')), '');
  if access_notes_value is not null and char_length(access_notes_value) > 2000 then
    raise exception 'access notes are too long';
  end if;

  customer_email_value := nullif(btrim(coalesce(payload->>'customer_email', '')), '');
  if customer_email_value is not null and (
    char_length(customer_email_value) > 200
    or customer_email_value !~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ) then
    raise exception 'email is not valid';
  end if;

  if preferred_value = 'asap' then
    if payload ? 'time_window' and payload->'time_window' is not null
      and jsonb_typeof(payload->'time_window') is distinct from 'null' then
      raise exception 'an ASAP request has no time window';
    end if;
    window_value := null;
  else
    begin
      window_value := (payload->>'time_window')::public.time_window;
    exception
      when invalid_text_representation then
        raise exception 'time window is not valid';
    end;
    if window_value is null then
      raise exception 'time window is required';
    end if;
  end if;

  if payload ? 'zone_slug' and jsonb_typeof(payload->'zone_slug') is distinct from 'null' then
    select id into zone_value
    from public.zones
    where slug = payload->>'zone_slug' and active;
    if zone_value is null then
      raise exception 'zone is not valid';
    end if;
  end if;

  offer_value := null;
  budget_min_value := null;
  budget_max_value := null;
  if pricing_value = 'quote' then
    if jsonb_typeof(payload->'offer_cents') is distinct from 'null'
      or jsonb_typeof(payload->'budget_min_cents') is distinct from 'null'
      or jsonb_typeof(payload->'budget_max_cents') is distinct from 'null' then
      raise exception 'a quote request has no customer price';
    end if;
  elsif pricing_value = 'fixed' then
    if coalesce(payload->>'offer_cents', '') !~ '^[0-9]+$' then
      raise exception 'a named price must be at least $35';
    end if;
    offer_value := (payload->>'offer_cents')::integer;
    if offer_value < 3500 then
      raise exception 'a named price must be at least $35';
    end if;
    if jsonb_typeof(payload->'budget_min_cents') is distinct from 'null'
      or jsonb_typeof(payload->'budget_max_cents') is distinct from 'null' then
      raise exception 'a named price has no budget range';
    end if;
  else
    if coalesce(payload->>'budget_min_cents', '') !~ '^[0-9]+$'
      or coalesce(payload->>'budget_max_cents', '') !~ '^[0-9]+$' then
      raise exception 'a budget range must start at $35';
    end if;
    budget_min_value := (payload->>'budget_min_cents')::integer;
    budget_max_value := (payload->>'budget_max_cents')::integer;
    if budget_min_value < 3500 or budget_max_value <= budget_min_value then
      raise exception 'a budget range must start at $35 and the maximum must be higher';
    end if;
    if jsonb_typeof(payload->'offer_cents') is distinct from 'null' then
      raise exception 'a budget range has no single price';
    end if;
  end if;

  dropoff_area_value := nullif(btrim(coalesce(payload->>'dropoff_area', '')), '');
  dropoff_address_value := nullif(btrim(coalesce(payload->>'dropoff_address', '')), '');
  stairs_dropoff_value := null;
  paid_value := null;
  holding_value := null;
  check_value := null;
  load_value := null;
  materials_value := null;
  special_value := null;
  store_name_value := null;
  store_order_value := null;

  if service_value = 'junk' then
    if dropoff_area_value is not null or dropoff_address_value is not null
      or (payload ? 'stairs_dropoff' and jsonb_typeof(payload->'stairs_dropoff') is distinct from 'null') then
      raise exception 'junk removal has no drop-off';
    end if;
    begin
      load_value := (payload->>'junk_load_size')::public.junk_load_size;
    exception
      when invalid_text_representation then
        raise exception 'load size is not valid';
    end;
    if load_value is null then
      raise exception 'load size is required';
    end if;
    materials_value := nullif(btrim(coalesce(payload->>'junk_materials', '')), '');
    if materials_value is null or char_length(materials_value) > 1000 then
      raise exception 'materials are required';
    end if;
    if jsonb_typeof(payload->'junk_special_items') is distinct from 'object' then
      raise exception 'special items are required';
    end if;
    select k into extra
    from jsonb_object_keys(payload->'junk_special_items') as k
    where k not in ('mattress', 'tires', 'appliances')
    limit 1;
    if extra is not null
      or jsonb_typeof(payload->'junk_special_items'->'mattress') is distinct from 'boolean'
      or jsonb_typeof(payload->'junk_special_items'->'tires') is distinct from 'boolean'
      or jsonb_typeof(payload->'junk_special_items'->'appliances') is distinct from 'boolean' then
      raise exception 'special items are not valid';
    end if;
    special_value := jsonb_build_object(
      'appliances', (payload->'junk_special_items'->>'appliances')::boolean,
      'mattress', (payload->'junk_special_items'->>'mattress')::boolean,
      'tires', (payload->'junk_special_items'->>'tires')::boolean
    );
  else
    if dropoff_area_value is null or char_length(dropoff_area_value) > 80
      or dropoff_address_value is null or char_length(dropoff_address_value) > 200 then
      raise exception 'drop-off area and address are required';
    end if;
    if coalesce(payload->>'stairs_dropoff', '') !~ '^[0-3]$' then
      raise exception 'stairs at drop-off must be 0 to 3';
    end if;
    stairs_dropoff_value := (payload->>'stairs_dropoff')::integer;
    if payload ? 'junk_load_size' and jsonb_typeof(payload->'junk_load_size') is distinct from 'null'
      or nullif(btrim(coalesce(payload->>'junk_materials', '')), '') is not null
      or (payload ? 'junk_special_items' and jsonb_typeof(payload->'junk_special_items') is distinct from 'null') then
      raise exception 'only junk removal has a load';
    end if;
  end if;

  if service_value = 'delivery' then
    if jsonb_typeof(payload->'already_paid') is distinct from 'boolean'
      or jsonb_typeof(payload->'seller_holding') is distinct from 'boolean'
      or jsonb_typeof(payload->'wants_item_check') is distinct from 'boolean' then
      raise exception 'delivery questions must be yes or no';
    end if;
    paid_value := (payload->>'already_paid')::boolean;
    holding_value := (payload->>'seller_holding')::boolean;
    check_value := (payload->>'wants_item_check')::boolean;
  elsif payload ? 'already_paid' and jsonb_typeof(payload->'already_paid') is distinct from 'null'
    or payload ? 'seller_holding' and jsonb_typeof(payload->'seller_holding') is distinct from 'null'
    or payload ? 'wants_item_check' and jsonb_typeof(payload->'wants_item_check') is distinct from 'null' then
    raise exception 'only delivery has purchase questions';
  end if;

  if service_value = 'construction' then
    store_name_value := nullif(btrim(coalesce(payload->>'store_name', '')), '');
    store_order_value := nullif(btrim(coalesce(payload->>'store_order_number', '')), '');
    if store_name_value is null or char_length(store_name_value) > 120 then
      raise exception 'store name is required';
    end if;
    if store_order_value is not null and char_length(store_order_value) > 80 then
      raise exception 'store order number is too long';
    end if;
  elsif nullif(btrim(coalesce(payload->>'store_name', '')), '') is not null
    or nullif(btrim(coalesce(payload->>'store_order_number', '')), '') is not null then
    raise exception 'only construction store deliveries have a store';
  end if;

  select exists (
    select 1
    from public.jobs j
    join public.job_private p on p.job_id = j.id
    where j.id = request_id
      and j.customer_id = uid
      and j.status = 'requested'
      and j.assigned_driver_id is null
      and j.price_cents is null
      and j.driver_pay_cents is null
      and j.platform_fee_cents is null
      and j.dump_fee_cents is null
      and j.quote_expires_at is null
      and j.accepted_offer_id is null
      and j.service = service_value
      and j.zone_id is not distinct from zone_value
      and j.pickup_area = pickup_area_value
      and j.dropoff_area is not distinct from dropoff_area_value
      and j.description = description_value
      and j.pieces = pieces_value
      and j.size = size_value
      and j.item_value_cents = item_value
      and j.needs_value_approval = needs_approval
      and j.listing_url is not distinct from listing_value
      and j.already_paid is not distinct from paid_value
      and j.seller_holding is not distinct from holding_value
      and j.wants_item_check is not distinct from check_value
      and j.stairs_pickup = stairs_pickup_value
      and j.stairs_dropoff is not distinct from stairs_dropoff_value
      and j.elevator = elevator_value
      and j.help_loading = help_value
      and j.junk_load_size is not distinct from load_value
      and j.junk_materials is not distinct from materials_value
      and j.junk_special_items is not distinct from special_value
      and j.store_name is not distinct from store_name_value
      and j.store_order_number is not distinct from store_order_value
      and j.preferred_date = preferred_value
      and j.time_window is not distinct from window_value
      and j.notes is not distinct from notes_value
      and j.pricing_method = pricing_value
      and j.offer_cents is not distinct from offer_value
      and j.budget_min_cents is not distinct from budget_min_value
      and j.budget_max_cents is not distinct from budget_max_value
      and j.source = source_value
      and p.pickup_address = pickup_address_value
      and p.dropoff_address is not distinct from dropoff_address_value
      and p.customer_name = customer_name_value
      and p.customer_phone = customer_phone_value
      and p.customer_email is not distinct from customer_email_value
      and p.access_notes is not distinct from access_notes_value
  ) into same_request;

  if public.request_id_visibility(request_id) = 'own' then
    if same_request then
      return request_id;
    end if;
    raise exception 'this request was already saved with different details';
  elsif public.request_id_visibility(request_id) = 'other' then
    raise exception 'request not found';
  end if;

  begin
    insert into public.jobs (
      id, customer_id, service, status, zone_id, pickup_area, dropoff_area,
      description, pieces, size, item_value_cents, needs_value_approval,
      listing_url, already_paid, seller_holding, wants_item_check,
      stairs_pickup, stairs_dropoff, elevator, help_loading,
      junk_load_size, junk_materials, junk_special_items,
      store_name, store_order_number, preferred_date, time_window, notes,
      pricing_method, offer_cents, budget_min_cents, budget_max_cents, source
    ) values (
      request_id, uid, service_value, 'requested', zone_value, pickup_area_value,
      dropoff_area_value, description_value, pieces_value, size_value, item_value,
      needs_approval, listing_value, paid_value, holding_value, check_value,
      stairs_pickup_value, stairs_dropoff_value, elevator_value, help_value,
      load_value, materials_value, special_value, store_name_value, store_order_value,
      preferred_value, window_value, notes_value, pricing_value, offer_value,
      budget_min_value, budget_max_value, source_value
    );

    insert into public.job_private (
      job_id, pickup_address, dropoff_address, customer_name, customer_phone,
      customer_email, access_notes
    ) values (
      request_id, pickup_address_value, dropoff_address_value, customer_name_value,
      customer_phone_value, customer_email_value, access_notes_value
    );
  exception
    when unique_violation then
      -- Another submit with this id finished first. Return it only when every
      -- saved field still matches. Do not change that row.
      if public.request_id_visibility(request_id) = 'other' then
        raise exception 'request not found';
      end if;
      select exists (
        select 1
        from public.jobs j
        join public.job_private p on p.job_id = j.id
        where j.id = request_id
          and j.customer_id = uid
          and j.status = 'requested'
          and j.assigned_driver_id is null
          and j.price_cents is null
          and j.driver_pay_cents is null
          and j.platform_fee_cents is null
          and j.dump_fee_cents is null
          and j.quote_expires_at is null
          and j.accepted_offer_id is null
          and j.service = service_value
          and j.zone_id is not distinct from zone_value
          and j.pickup_area = pickup_area_value
          and j.dropoff_area is not distinct from dropoff_area_value
          and j.description = description_value
          and j.pieces = pieces_value
          and j.size = size_value
          and j.item_value_cents = item_value
          and j.needs_value_approval = needs_approval
          and j.listing_url is not distinct from listing_value
          and j.already_paid is not distinct from paid_value
          and j.seller_holding is not distinct from holding_value
          and j.wants_item_check is not distinct from check_value
          and j.stairs_pickup = stairs_pickup_value
          and j.stairs_dropoff is not distinct from stairs_dropoff_value
          and j.elevator = elevator_value
          and j.help_loading = help_value
          and j.junk_load_size is not distinct from load_value
          and j.junk_materials is not distinct from materials_value
          and j.junk_special_items is not distinct from special_value
          and j.store_name is not distinct from store_name_value
          and j.store_order_number is not distinct from store_order_value
          and j.preferred_date = preferred_value
          and j.time_window is not distinct from window_value
          and j.notes is not distinct from notes_value
          and j.pricing_method = pricing_value
          and j.offer_cents is not distinct from offer_value
          and j.budget_min_cents is not distinct from budget_min_value
          and j.budget_max_cents is not distinct from budget_max_value
          and j.source = source_value
          and p.pickup_address = pickup_address_value
          and p.dropoff_address is not distinct from dropoff_address_value
          and p.customer_name = customer_name_value
          and p.customer_phone = customer_phone_value
          and p.customer_email is not distinct from customer_email_value
          and p.access_notes is not distinct from access_notes_value
      ) into same_request;
      if same_request then
        return request_id;
      end if;
      raise exception 'this request was already saved with different details';
  end;

  return request_id;
end;
$function$;

comment on function public.create_customer_request(uuid, jsonb) is
  'Inserts one requested job for auth.uid(). Retries do not update the saved job.';

revoke all on function public.create_customer_request(uuid, jsonb) from public;
revoke all on function public.create_customer_request(uuid, jsonb) from anon;
revoke all on function public.create_customer_request(uuid, jsonb) from service_role;
grant execute on function public.create_customer_request(uuid, jsonb) to authenticated;

-- Records a request photo row. A second call with the same path returns the
-- existing row and does not insert another one.
create or replace function public.attach_request_photo(
  target_job_id uuid,
  target_path text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  existing_id uuid;
  existing_job uuid;
  existing_stage public.photo_stage;
  existing_uploader uuid;
  inserted_id uuid;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;
  if target_job_id is null or target_path is null then
    raise exception 'photo path is required';
  end if;
  if target_path !~ (
    '^' || target_job_id::text || '/request/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.jpg$'
  ) then
    raise exception 'invalid photo path';
  end if;
  if not exists (
    select 1
    from public.jobs
    where id = target_job_id
      and customer_id = uid
      and status = 'requested'
  ) then
    raise exception 'request not found';
  end if;

  select id, job_id, stage, uploaded_by
  into existing_id, existing_job, existing_stage, existing_uploader
  from public.job_photos
  where storage_path = target_path;

  if existing_id is not null then
    if existing_job = target_job_id
      and existing_stage = 'request'
      and existing_uploader = uid then
      return existing_id;
    end if;
    raise exception 'photo path is already used';
  end if;

  begin
    insert into public.job_photos (job_id, stage, storage_path, uploaded_by)
    values (target_job_id, 'request', target_path, uid)
    returning id into inserted_id;
  exception
    when unique_violation then
      select id into inserted_id
      from public.job_photos
      where storage_path = target_path
        and job_id = target_job_id
        and stage = 'request'
        and uploaded_by = uid;
      if inserted_id is null then
        raise exception 'photo path is already used';
      end if;
  end;

  return inserted_id;
end;
$function$;

comment on function public.attach_request_photo(uuid, text) is
  'Adds one request photo row. The same path returns the existing row.';

revoke all on function public.attach_request_photo(uuid, text) from public;
revoke all on function public.attach_request_photo(uuid, text) from anon;
revoke all on function public.attach_request_photo(uuid, text) from service_role;
grant execute on function public.attach_request_photo(uuid, text) to authenticated;
