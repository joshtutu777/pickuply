import { splitJob } from "./split-job";
import { legacyWhen } from "../time/pickup-schedule";
import type { RequestDraft } from "../types";

/**
 * The exact object create_customer_request accepts.
 * Price, driver, and booking fields are not included. The database sets those.
 */
export function requestPayload(draft: RequestDraft): Record<string, unknown> {
  const { job, privateJob } = splitJob(draft, "00000000-0000-4000-8000-000000000000", []);
  const junk = job.service === "junk";
  const availability = draft.pickupAvailability === "asap" || draft.pickupAvailability === "windows"
    ? draft.pickupAvailability
    : "anytime";
  const when = legacyWhen(availability, availability === "windows" ? draft.pickupWindows : []);
  return {
    service: job.service,
    description: job.description,
    pieces: job.pieces,
    size: job.size,
    item_value_cents: job.item_value_cents,
    listing_url: job.listing_url,
    already_paid: job.already_paid,
    seller_holding: job.seller_holding,
    wants_item_check: job.wants_item_check,
    stairs_pickup: job.stairs_pickup,
    stairs_dropoff: job.stairs_dropoff,
    elevator: job.elevator,
    help_loading: job.help_loading,
    junk_load_size: job.junk_load_size,
    junk_materials: job.junk_materials,
    junk_special_items: job.junk_special_items,
    store_name: job.store_name,
    store_order_number: job.store_order_number,
    preferred_date: when.preferred_date,
    time_window: when.time_window,
    pickup_availability: availability,
    pickup_windows: availability === "windows" ? draft.pickupWindows : [],
    notes: job.notes,
    pricing_method: job.pricing_method,
    offer_cents: job.offer_cents,
    budget_min_cents: job.budget_min_cents,
    budget_max_cents: job.budget_max_cents,
    source: job.source,
    zone_slug: job.zone_id,
    pickup_area: job.pickup_area,
    dropoff_area: junk ? null : job.dropoff_area,
    pickup_address: privateJob.pickup_address,
    dropoff_address: junk ? null : privateJob.dropoff_address,
    customer_name: privateJob.customer_name,
    customer_phone: privateJob.customer_phone,
    customer_email: privateJob.customer_email,
    access_notes: privateJob.access_notes,
  };
}
