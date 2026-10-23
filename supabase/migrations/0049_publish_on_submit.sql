begin;

-- A valid customer request is open to drivers as soon as it is saved.
-- Get Offers jobs collect driver offers until the customer chooses one.
-- An admin quote that already has driver pay can still be claimed.
-- Pause, an admin quote, and sending a job to a driver stay optional and audited.

alter table public.jobs
  add column paused_at timestamptz;

create or replace function public.guard_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prices_allowed boolean := coalesce(public.can_set_quote_prices(), false)
    or coalesce(current_setting('pickuply.offer_chosen', true), '') = 'yes'
    or coalesce(current_setting('pickuply.job_claimed', true), '') = 'yes';
  booking_step boolean := coalesce(current_setting('pickuply.job_claimed', true), '') = 'yes'
    or coalesce(current_setting('pickuply.offer_chosen', true), '') = 'yes';
  system_payment boolean := coalesce(current_setting('pickuply.system_payment', true), '') = 'yes';
  system_release boolean := coalesce(current_setting('pickuply.system_release', true), '') = 'yes';
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not public.is_admin() and not public.is_migration_session() then
      if new.customer_id is distinct from auth.uid() then
        raise exception 'customers can only create their own jobs';
      end if;
      if new.status is distinct from 'requested' and new.status is distinct from 'open' then
        raise exception 'new jobs start as requested';
      end if;
    end if;
  else
    if new.pricing_method is distinct from old.pricing_method
      or new.offer_cents is distinct from old.offer_cents
      or new.budget_min_cents is distinct from old.budget_min_cents
      or new.budget_max_cents is distinct from old.budget_max_cents then
      raise exception 'the customer pricing preference cannot be changed';
    end if;

    if old.pricing_method = 'quote'
      and old.status = 'quoted'
      and new.status = 'open'
      and current_setting('pickuply.quote_accepted', true) is distinct from 'yes' then
      raise exception 'a quote job is published only when the customer accepts it';
    end if;

    if new.status = 'assigned'
      and old.status is distinct from 'open'
      and old.status is distinct from 'assigned' then
      raise exception 'assignment only follows an open job';
    end if;

    if new.status in ('en_route', 'arrived', 'item_check', 'in_transit', 'delivered', 'completed')
      and new.status is distinct from old.status
      and coalesce(new.payment_status, '') not in ('authorized', 'paid', 'captured') then
      raise exception 'payment must be authorized before work starts';
    end if;

    if new.assigned_driver_id is distinct from old.assigned_driver_id
      and not (
        coalesce(public.is_migration_session(), false)
        or booking_step
        or system_release
        or (
          coalesce(public.is_admin(), false)
          and coalesce(current_setting('pickuply.admin_assign', true), '') = 'yes'
        )
      ) then
      raise exception 'only an admin can assign a driver';
    end if;

    if (
      new.payment_status is distinct from old.payment_status
      or new.payment_due_at is distinct from old.payment_due_at
    ) and not (
      coalesce(public.is_migration_session(), false)
      or coalesce(public.is_admin(), false)
      or booking_step
      or system_payment
    ) then
      raise exception 'only the booking step can set payment status';
    end if;

    if (
      new.payment_status is distinct from old.payment_status
      or new.payment_due_at is distinct from old.payment_due_at
    )
      and coalesce(public.is_admin(), false)
      and not coalesce(public.is_migration_session(), false)
      and not booking_step
      and not system_payment then
      insert into public.audit_log (actor_id, action, target_type, target_id, data)
      values (
        auth.uid(),
        'set_payment_status',
        'job',
        new.id,
        jsonb_build_object('payment_status', new.payment_status)
      );
    end if;
  end if;

  if tg_op = 'INSERT' then
    if (
      new.price_cents is not null
      or new.driver_pay_cents is not null
      or new.platform_fee_cents is not null
      or new.service_fee_cents is not null
      or new.dump_fee_cents is not null
      or new.quote_expires_at is not null
    ) and not prices_allowed then
      raise exception 'only an admin can set quote prices';
    end if;
  elsif (
    new.price_cents is distinct from old.price_cents
    or new.driver_pay_cents is distinct from old.driver_pay_cents
    or new.platform_fee_cents is distinct from old.platform_fee_cents
    or new.service_fee_cents is distinct from old.service_fee_cents
    or new.dump_fee_cents is distinct from old.dump_fee_cents
    or new.quote_expires_at is distinct from old.quote_expires_at
  ) and not prices_allowed then
    raise exception 'only an admin can change quote prices';
  end if;

  if tg_op = 'INSERT' and new.status = 'assigned' then
    raise exception 'assignment only follows an open job';
  end if;


  if new.status in ('requested', 'in_review', 'quoted', 'open') and new.assigned_driver_id is not null then
    raise exception 'assigned_driver_id is set only when a driver is assigned';
  end if;
  if new.status = 'assigned' and new.assigned_driver_id is null then
    raise exception 'an assigned job needs an assigned driver';
  end if;

  if tg_op = 'UPDATE'
    and new.paused_at is distinct from old.paused_at
    and coalesce(current_setting('pickuply.admin_pause', true), '') is distinct from 'yes'
    and not public.is_migration_session() then
    raise exception 'only an admin can pause a request';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

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
    'customer_email', 'access_notes', 'has_photo'
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
    pricing_value := (payload->>'pricing_method')::public.pricing_method;
    if coalesce(payload->>'size', '') <> '' then
      size_value := (payload->>'size')::public.item_size;
    end if;
  exception
    when invalid_text_representation then
      raise exception 'service, size, or pricing method is not valid';
  end;

  if service_value is null or pricing_value is null then
    raise exception 'service and pricing method are required';
  end if;

  if coalesce(payload->>'pieces', '') = '' then
    pieces_value := null;
  elsif payload->>'pieces' !~ '^[0-9]+$' then
    raise exception 'pieces must be a whole number';
  else
    pieces_value := (payload->>'pieces')::integer;
    if pieces_value < 1 or pieces_value > 100 then
      raise exception 'pieces must be from 1 to 100';
    end if;
  end if;

  if coalesce(payload->>'item_value_cents', '') = '' then
    item_value := null;
    needs_approval := false;
  elsif payload->>'item_value_cents' !~ '^[0-9]+$' then
    raise exception 'item value must be a whole number of cents';
  else
    item_value := (payload->>'item_value_cents')::integer;
    if item_value > 100000000 then
      raise exception 'item value is too large';
    end if;
    needs_approval := item_value > 100000;
  end if;

  if coalesce(payload->>'stairs_pickup', '') = '' then
    stairs_pickup_value := 0;
  elsif payload->>'stairs_pickup' !~ '^[0-3]$' then
    raise exception 'stairs at pickup must be 0 to 3';
  else
    stairs_pickup_value := (payload->>'stairs_pickup')::integer;
  end if;

  if payload->'elevator' is null or jsonb_typeof(payload->'elevator') = 'null' then
    elevator_value := false;
  elsif jsonb_typeof(payload->'elevator') is distinct from 'boolean' then
    raise exception 'elevator and help loading must be yes or no';
  else
    elevator_value := (payload->>'elevator')::boolean;
  end if;
  if payload->'help_loading' is null or jsonb_typeof(payload->'help_loading') = 'null' then
    help_value := false;
  elsif jsonb_typeof(payload->'help_loading') is distinct from 'boolean' then
    raise exception 'elevator and help loading must be yes or no';
  else
    help_value := (payload->>'help_loading')::boolean;
  end if;

  description_value := btrim(coalesce(payload->>'description', ''));
  pickup_area_value := btrim(coalesce(payload->>'pickup_area', ''));
  pickup_address_value := btrim(coalesce(payload->>'pickup_address', ''));
  customer_name_value := btrim(coalesce(payload->>'customer_name', ''));
  customer_phone_value := btrim(coalesce(payload->>'customer_phone', ''));
  preferred_value := btrim(coalesce(payload->>'preferred_date', ''));
  source_value := btrim(coalesce(payload->>'source', ''));

  if char_length(description_value) > 2000 then
    raise exception 'description must be 1 to 2000 characters';
  end if;
  if char_length(description_value) < 1 and coalesce((payload->>'has_photo')::boolean, false) is not true then
    raise exception 'add a photo or a short description';
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
  if source_value = '' then
    source_value := null;
  elsif source_value not in ('nextdoor', 'facebook', 'friend', 'landlord', 'other') then
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
    materials_value := nullif(btrim(coalesce(payload->>'junk_materials', '')), '');
    if materials_value is not null and char_length(materials_value) > 1000 then
      raise exception 'materials are required';
    end if;
    if payload->'junk_special_items' is null or jsonb_typeof(payload->'junk_special_items') = 'null' then
      special_value := null;
    elsif jsonb_typeof(payload->'junk_special_items') is distinct from 'object' then
      raise exception 'special items are required';
    else
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
    end if;
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
    if payload->'already_paid' is not null and jsonb_typeof(payload->'already_paid') is distinct from 'null'
      and jsonb_typeof(payload->'already_paid') is distinct from 'boolean' then
      raise exception 'delivery questions must be yes or no';
    end if;
    if payload->'seller_holding' is not null and jsonb_typeof(payload->'seller_holding') is distinct from 'null'
      and jsonb_typeof(payload->'seller_holding') is distinct from 'boolean' then
      raise exception 'delivery questions must be yes or no';
    end if;
    if payload->'wants_item_check' is not null and jsonb_typeof(payload->'wants_item_check') is distinct from 'null'
      and jsonb_typeof(payload->'wants_item_check') is distinct from 'boolean' then
      raise exception 'delivery questions must be yes or no';
    end if;
    if jsonb_typeof(payload->'already_paid') = 'boolean' then
      paid_value := (payload->>'already_paid')::boolean;
    end if;
    if jsonb_typeof(payload->'seller_holding') = 'boolean' then
      holding_value := (payload->>'seller_holding')::boolean;
    end if;
    if jsonb_typeof(payload->'wants_item_check') = 'boolean' then
      check_value := (payload->>'wants_item_check')::boolean;
    end if;
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
      and j.status = 'open'
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
      and j.pieces is not distinct from pieces_value
      and j.size is not distinct from size_value
      and j.item_value_cents is not distinct from item_value
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
      and j.source is not distinct from source_value
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
      request_id, uid, service_value, 'open', zone_value, pickup_area_value,
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
          and j.status = 'open'
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
          and j.pieces is not distinct from pieces_value
          and j.size is not distinct from size_value
          and j.item_value_cents is not distinct from item_value
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
          and j.source is not distinct from source_value
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

create or replace function public.guard_job_offers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
  driver_row public.drivers%rowtype;
  trusted boolean := coalesce(public.is_migration_session(), false)
    or coalesce(current_setting('pickuply.offer_chosen', true), '') = 'yes';
  priced boolean := coalesce(current_setting('pickuply.offer_priced', true), '') = 'yes';
  expected jsonb;
  cap integer;
begin
  if new.status = 'chosen'
    and current_setting('pickuply.offer_chosen', true) is distinct from 'yes' then
    raise exception 'choosing an offer requires the customer booking step';
  end if;

  if tg_op = 'UPDATE'
    and new.driver_amount_cents is not distinct from old.driver_amount_cents
    and new.platform_fee_cents is not distinct from old.platform_fee_cents
    and new.service_fee_cents is not distinct from old.service_fee_cents
    and new.customer_total_cents is not distinct from old.customer_total_cents
    and new.kind is not distinct from old.kind
    and new.outside_range is not distinct from old.outside_range then
    return new;
  end if;

  select * into job_row from public.jobs where id = new.job_id;
  if not found then
    raise exception 'job not found';
  end if;
  if job_row.pricing_method = 'quote' and not priced then
    raise exception 'drivers cannot offer on a quote job';
  end if;

  if not trusted then
    if auth.uid() is null or new.driver_id is distinct from auth.uid() then
      raise exception 'only the signed-in driver can create this offer';
    end if;
    if job_row.status <> 'open' then
      raise exception 'offers are only allowed on open jobs';
    end if;
    select * into driver_row from public.drivers where profile_id = auth.uid();
    if not found or not driver_row.is_online then
      raise exception 'go online before sending an offer';
    end if;
    if not public.driver_is_eligible_for_job(new.job_id) then
      raise exception 'this driver cannot offer on this job';
    end if;
    if tg_op = 'INSERT' and exists (
      select 1 from public.job_offers
      where job_id = new.job_id and driver_id = new.driver_id and status = 'active'
    ) then
      raise exception 'withdraw your current offer before sending another';
    end if;
    if tg_op = 'INSERT' and new.status <> 'active' then
      raise exception 'a new offer starts as active';
    end if;
  end if;

  if priced then
    expected := public.price_breakdown(
      case when new.kind = 'accept' then 'accept' else 'forward' end,
      case when new.kind = 'accept' then job_row.offer_cents else new.driver_amount_cents end
    );
    if new.driver_amount_cents is distinct from (expected->>'driver_earnings_cents')::integer
      or new.platform_fee_cents is distinct from (expected->>'platform_fee_cents')::integer
      or new.service_fee_cents is distinct from (expected->>'service_fee_cents')::integer
      or new.customer_total_cents is distinct from (expected->>'customer_total_cents')::integer then
      raise exception 'offer amounts do not match the fee schedule';
    end if;
    if job_row.pricing_method = 'quote' then
      if new.kind is distinct from 'offer' or new.outside_range then
        raise exception 'a driver price on this job is an offer';
      end if;
      return new;
    end if;
    if job_row.pricing_method = 'fixed' then
      if new.kind = 'accept' and (new.customer_total_cents is distinct from job_row.offer_cents or new.outside_range) then
        raise exception 'accepting a fixed price must match the customer price';
      end if;
      if new.kind = 'counter' and (new.customer_total_cents = job_row.offer_cents or not new.outside_range) then
        raise exception 'a fixed-price counteroffer must differ and be flagged';
      end if;
      cap := job_row.offer_cents * 2;
    else
      if new.customer_total_cents between job_row.budget_min_cents and job_row.budget_max_cents then
        if new.outside_range or new.kind <> 'offer' then
          raise exception 'an in-range amount is an offer and is not flagged';
        end if;
      elsif not new.outside_range or new.kind <> 'counter' then
        raise exception 'an amount outside the range must be a flagged counteroffer';
      end if;
      cap := job_row.budget_max_cents * 2;
    end if;
    if new.kind = 'counter' and new.customer_total_cents > cap then
      raise exception 'a counteroffer cannot exceed twice the customer price';
    end if;
    return new;
  end if;

  if job_row.pricing_method = 'fixed' then
    if new.kind = 'offer' then
      raise exception 'fixed jobs use accept or counter';
    end if;
    if new.kind = 'accept' and (new.driver_amount_cents is distinct from job_row.offer_cents or new.outside_range) then
      raise exception 'accepting a fixed price must match the customer price';
    end if;
    if new.kind = 'counter' and (new.driver_amount_cents = job_row.offer_cents or not new.outside_range) then
      raise exception 'a fixed-price counteroffer must differ and be flagged';
    end if;
  elsif job_row.pricing_method = 'range' then
    if new.kind = 'accept' then
      raise exception 'range jobs use offer or counter';
    end if;
    if new.driver_amount_cents between job_row.budget_min_cents and job_row.budget_max_cents then
      if new.outside_range or new.kind <> 'offer' then
        raise exception 'an in-range amount is an offer and is not flagged';
      end if;
    elsif not new.outside_range or new.kind <> 'counter' then
      raise exception 'an amount outside the range must be a flagged counteroffer';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.submit_offer(
  target_job uuid,
  kind text,
  earnings_cents integer,
  reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
  breakdown jsonb;
  offer_kind public.offer_kind;
  outside boolean := false;
  offer_id uuid;
begin
  perform public.assert_driver_can_take_job(target_job, 'offer');
  update public.job_offers
  set status = 'expired'
  where job_id = target_job and driver_id = uid and status = 'active' and expires_at <= now();
  if exists (
    select 1 from public.job_offers
    where job_id = target_job and driver_id = uid and status = 'active'
  ) then
    raise exception 'withdraw your current offer before sending another';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.status <> 'open' then
    raise exception 'offers are only allowed on open jobs';
  end if;
  if job_row.pricing_method = 'quote' then
    breakdown := public.price_breakdown('forward', earnings_cents);
    offer_kind := 'offer';
  elsif job_row.pricing_method = 'fixed' and kind = 'accept' then
    breakdown := public.price_breakdown('accept', job_row.offer_cents);
    offer_kind := 'accept';
  else
    breakdown := public.price_breakdown('forward', earnings_cents);
    if job_row.pricing_method = 'fixed' then
      if (breakdown->>'customer_total_cents')::integer = job_row.offer_cents then
        raise exception 'accept the posted price instead of countering with the same total';
      end if;
      offer_kind := 'counter';
      outside := true;
    elsif (breakdown->>'customer_total_cents')::integer
      between job_row.budget_min_cents and job_row.budget_max_cents then
      offer_kind := 'offer';
    else
      offer_kind := 'counter';
      outside := true;
    end if;
  end if;
  if offer_kind = 'counter' and length(btrim(coalesce(reason, ''))) < 3 then
    raise exception 'a counteroffer needs a reason';
  end if;
  perform set_config('pickuply.offer_priced', 'yes', true);
  insert into public.job_offers (
    job_id, driver_id, kind, driver_amount_cents, platform_fee_cents, service_fee_cents,
    customer_total_cents, reason, outside_range, status, expires_at
  ) values (
    target_job, uid, offer_kind,
    (breakdown->>'driver_earnings_cents')::integer,
    (breakdown->>'platform_fee_cents')::integer,
    (breakdown->>'service_fee_cents')::integer,
    (breakdown->>'customer_total_cents')::integer,
    nullif(btrim(coalesce(reason, '')), ''),
    outside, 'active', now() + interval '2 hours'
  )
  returning id into offer_id;
  return offer_id;
end;
$function$;

create or replace function public.review_request(
  target_job uuid,
  action text,
  details jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  job_row public.jobs%rowtype;
  zone uuid;
  level public.service_level;
  vehicle public.vehicle_type;
  needs_ack boolean;
  breakdown jsonb;
  hours integer;
begin
  if not public.is_admin() then
    raise exception 'only an admin can review requests';
  end if;
  if action not in ('publish', 'quote', 'changes', 'decline') then
    raise exception 'choose a review action';
  end if;

  select * into job_row from public.jobs where id = target_job for update;
  if not found then
    raise exception 'request not found';
  end if;
  if job_row.status not in ('requested', 'in_review', 'quoted', 'open') then
    raise exception 'this request is no longer waiting for review';
  end if;

  if action = 'decline' then
    update public.jobs
    set status = 'cancelled', admin_note = nullif(btrim(coalesce(details->>'note', '')), '')
    where id = target_job;
  elsif action = 'changes' then
    if length(btrim(coalesce(details->>'note', ''))) < 3 then
      raise exception 'add a note the customer can read';
    end if;
    update public.jobs
    set status = 'in_review', admin_note = btrim(details->>'note')
    where id = target_job;
  else
    if action = 'publish' and job_row.status not in ('requested', 'in_review') then
      raise exception 'this request is no longer waiting for review';
    end if;
    if action = 'quote' and job_row.status not in ('requested', 'in_review', 'open') then
      raise exception 'this request is no longer waiting for review';
    end if;
    zone := nullif(details->>'zone_id', '')::uuid;
    if zone is null or not exists (select 1 from public.zones where id = zone and active) then
      zone := job_row.zone_id;
    end if;
    if zone is null or not exists (select 1 from public.zones where id = zone and active) then
      raise exception 'choose a zone';
    end if;
    if details->>'service_level' not in ('light', 'full') then
      raise exception 'choose a service level';
    end if;
    if details->>'required_vehicle' not in ('car', 'suv', 'pickup', 'van', 'box_truck', 'trailer') then
      raise exception 'choose the required vehicle';
    end if;
    level := (details->>'service_level')::public.service_level;
    vehicle := (details->>'required_vehicle')::public.vehicle_type;
    needs_ack := job_row.needs_value_approval
      or job_row.description ~* '(piano|gun safe|pool table|hot tub|\msafe\M)'
      or coalesce(job_row.junk_special_items::text, '') ~* '(piano|gun safe|pool table|hot tub|\msafe\M)';
    if needs_ack and coalesce((details->>'high_value_ok')::boolean, false) is not true then
      raise exception 'confirm the high-value or specialty item before publishing';
    end if;

    if action = 'publish' then
      if job_row.pricing_method not in ('fixed', 'range') then
        raise exception 'quote jobs are sent as a quote, not published directly';
      end if;
      update public.jobs
      set
        status = 'open',
        zone_id = zone,
        service_level = level,
        required_vehicle = vehicle,
        dump_fee_cents = greatest(coalesce((details->>'dump_fee_cents')::integer, 0), 0),
        admin_note = null
      where id = target_job;
    else
      if job_row.pricing_method <> 'quote' then
        raise exception 'only quote requests use an admin price';
      end if;
      if details->>'time_window' not in ('morning', 'afternoon', 'evening')
        or length(btrim(coalesce(details->>'preferred_date', ''))) < 4 then
        raise exception 'choose a pickup window';
      end if;
      breakdown := public.price_breakdown('forward', (details->>'driver_pay_cents')::integer);
      if (breakdown->>'customer_total_cents')::integer < 3500 then
        raise exception 'the customer total must be at least $35';
      end if;
      hours := coalesce((details->>'expires_hours')::integer, 24);
      if hours < 1 or hours > 168 then
        raise exception 'quote expiry must be between 1 and 168 hours';
      end if;
      update public.jobs
      set
        status = 'quoted',
        zone_id = zone,
        service_level = level,
        required_vehicle = vehicle,
        dump_fee_cents = greatest(coalesce((details->>'dump_fee_cents')::integer, 0), 0),
        driver_pay_cents = (breakdown->>'driver_earnings_cents')::integer,
        platform_fee_cents = (breakdown->>'platform_fee_cents')::integer,
        service_fee_cents = (breakdown->>'service_fee_cents')::integer,
        price_cents = (breakdown->>'customer_total_cents')::integer,
        preferred_date = btrim(details->>'preferred_date'),
        time_window = (details->>'time_window')::public.time_window,
        quote_expires_at = now() + make_interval(hours => hours),
        admin_note = null
      where id = target_job;
    end if;
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (auth.uid(), 'review_request', 'job', target_job, jsonb_build_object('action', action, 'details', details));
end;
$function$;

create or replace function public.job_passes_filters(driver uuid, job_row public.jobs)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  filt public.driver_feed_filters%rowtype;
begin
  if job_row.paused_at is not null then
    return false;
  end if;
  select * into filt from public.driver_feed_filters where profile_id = driver;
  if not found then
    return true;
  end if;
  if not filt.show_all and not public.coverage_matches(driver, job_row.pickup_area) then
    return false;
  end if;
  if cardinality(filt.services) > 0 and not job_row.service = any (filt.services) then
    return false;
  end if;
  if filt.vehicle_fit and job_row.required_vehicle is not null and not exists (
    select 1 from public.vehicles
    where driver_id = driver and type = job_row.required_vehicle
  ) then
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.claim_job(target_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  job_row public.jobs%rowtype;
begin
  if uid is null then
    raise exception 'sign in required';
  end if;

  select * into job_row
  from public.jobs
  where id = target_job
  for update;

  if not found or job_row.status <> 'open' or job_row.pricing_method <> 'quote' then
    raise exception 'job already taken';
  end if;
  if job_row.driver_pay_cents is null then
    raise exception 'send an offer instead';
  end if;

  perform public.assert_driver_can_take_job(target_job, 'claim');

  perform set_config('pickuply.job_claimed', 'yes', true);
  update public.jobs
  set
    status = 'assigned',
    assigned_driver_id = uid,
    payment_status = 'awaiting_payment',
    payment_due_at = public.payment_due_at()
  where id = target_job;

  insert into public.job_events (job_id, actor_id, type, data)
  values (target_job, uid, 'claimed', jsonb_build_object('to', 'assigned'));
end;
$function$;

create or replace function public.pause_request(target_job uuid, should_pause boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can pause a request';
  end if;
  select * into job_row from public.jobs where id = target_job for update;
  if not found or job_row.status <> 'open' then
    raise exception 'only an open request can be paused';
  end if;
  perform set_config('pickuply.admin_pause', 'yes', true);
  update public.jobs
  set paused_at = case when should_pause then coalesce(job_row.paused_at, now()) else null end
  where id = target_job;
  insert into public.audit_log (actor_id, action, target_type, target_id, data)
  values (
    auth.uid(),
    case when should_pause then 'pause_request' else 'resume_request' end,
    'job',
    target_job,
    jsonb_build_object('paused', should_pause)
  );
  insert into public.job_events (job_id, actor_id, type, data)
  values (
    target_job,
    auth.uid(),
    case when should_pause then 'paused' else 'resumed' end,
    jsonb_build_object('paused', should_pause)
  );
end;
$$;

revoke all on function public.pause_request(uuid, boolean) from public, anon, service_role;
grant execute on function public.pause_request(uuid, boolean) to authenticated;

create temporary table published_requests (id uuid primary key) on commit drop;

with moved as (
  update public.jobs
  set status = 'open'
  where status = 'requested'
    and (detail_request is null or detail_request->>'answered_at' is not null)
  returning id
)
insert into published_requests (id)
select id from moved;

insert into public.audit_log (actor_id, action, target_type, target_id, data)
select
  null,
  'publish_waiting_request',
  'job',
  id,
  jsonb_build_object('from', 'requested', 'to', 'open', 'reason', 'requests publish when they are submitted')
from published_requests;

commit;
