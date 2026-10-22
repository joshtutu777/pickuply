import { fees, zoneForCity } from "../constants";
import { parseDollarsToCents } from "../money";
import { normalizeUsPhone } from "../phone";
import type { PrivateJob, PublicJob, RequestDraft } from "../types";
import { itemValueCents, needsValueApproval } from "../validation/request";

const privateKeys = [
  "pickup_address",
  "dropoff_address",
  "customer_name",
  "customer_phone",
  "customer_email",
  "access_notes",
] as const;

export function publicJobKeys(): readonly string[] {
  return [
    "id",
    "customer_id",
    "service",
    "status",
    "zone_id",
    "pickup_area",
    "dropoff_area",
    "description",
    "pieces",
    "size",
    "item_value_cents",
    "needs_value_approval",
    "listing_url",
    "already_paid",
    "seller_holding",
    "wants_item_check",
    "stairs_pickup",
    "stairs_dropoff",
    "elevator",
    "help_loading",
    "junk_load_size",
    "junk_materials",
    "junk_special_items",
    "store_name",
    "store_order_number",
    "preferred_date",
    "time_window",
    "notes",
    "pricing_method",
    "offer_cents",
    "budget_min_cents",
    "budget_max_cents",
    "source",
    "photo_ids",
    "created_at",
  ];
}

export function assertPublicJob(job: PublicJob): void {
  for (const key of privateKeys) {
    if (key in job) {
      throw new Error(`Public job must not include ${key}.`);
    }
  }
}

function yesNo(value: RequestDraft["alreadyPaid"]): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function area(city: string, zip: string): string {
  return `${city.trim()}, ${zip.trim()}`;
}

/**
 * Splits a completed draft into the public job and the private record.
 * Call this only after validation. It does not read browser storage.
 */
export function splitJob(
  draft: RequestDraft,
  id: string,
  photoIds: string[],
  createdAt = new Date().toISOString(),
): { job: PublicJob; privateJob: PrivateJob } {
  if (!draft.service || !draft.pricingMethod) {
    throw new Error("Request is incomplete.");
  }
  const phone = normalizeUsPhone(draft.customerPhone);
  const value = itemValueCents(draft);
  const pieceText = draft.pieces.trim();
  const pieceCount = pieceText === "" ? null : Number(pieceText);
  if (!phone || (pieceCount != null && !Number.isInteger(pieceCount))) {
    throw new Error("Request is incomplete.");
  }

  const junk = draft.service === "junk";
  const delivery = draft.service === "delivery";
  const offer = draft.pricingMethod === "fixed" ? parseDollarsToCents(draft.offerDollars) : null;
  const budgetMin = draft.pricingMethod === "range" ? parseDollarsToCents(draft.budgetMinDollars) : null;
  const budgetMax = draft.pricingMethod === "range" ? parseDollarsToCents(draft.budgetMaxDollars) : null;

  const job: PublicJob = {
    id,
    customer_id: null,
    service: draft.service,
    status: "requested",
    zone_id: zoneForCity(draft.pickupCity),
    pickup_area: area(draft.pickupCity, draft.pickupZip),
    dropoff_area: junk ? null : area(draft.dropoffCity, draft.dropoffZip),
    description: draft.description.trim(),
    pieces: pieceCount,
    size: draft.size || null,
    item_value_cents: value,
    needs_value_approval: value != null && needsValueApproval(value),
    listing_url: draft.listingUrl.trim() || null,
    already_paid: delivery ? yesNo(draft.alreadyPaid) : null,
    seller_holding: delivery ? yesNo(draft.sellerHolding) : null,
    wants_item_check: delivery ? yesNo(draft.wantsItemCheck) : null,
    stairs_pickup: draft.stairsPickup === "" ? 0 : Number(draft.stairsPickup),
    stairs_dropoff: junk ? null : draft.stairsDropoff === "" ? 0 : Number(draft.stairsDropoff),
    elevator: draft.elevator === "yes",
    help_loading: draft.helpLoading === "yes",
    junk_load_size: junk ? draft.junkLoadSize || null : null,
    junk_materials: junk ? draft.junkMaterials.trim() : null,
    junk_special_items: junk
      ? {
          mattress: draft.junkMattress,
          tires: draft.junkTires,
          appliances: draft.junkAppliances,
        }
      : null,
    store_name: draft.service === "construction" ? draft.storeName.trim() : null,
    store_order_number:
      draft.service === "construction" && draft.storeOrderNumber.trim()
        ? draft.storeOrderNumber.trim()
        : null,
    preferred_date: draft.preferredDate,
    time_window: draft.preferredDate === "asap" ? null : draft.timeWindow || null,
    notes: draft.notes.trim() || null,
    pricing_method: draft.pricingMethod,
    offer_cents: offer,
    budget_min_cents: budgetMin,
    budget_max_cents: budgetMax,
    source: draft.hearAbout || null,
    photo_ids: photoIds,
    created_at: createdAt,
  };

  const privateJob: PrivateJob = {
    job_id: id,
    pickup_address: draft.pickupStreet.trim(),
    dropoff_address: junk ? null : draft.dropoffStreet.trim(),
    customer_name: draft.customerName.trim(),
    customer_phone: phone,
    customer_email: draft.customerEmail.trim() || null,
    access_notes: draft.accessNotes.trim() || null,
  };

  assertPublicJob(job);
  if (
    job.item_value_cents != null &&
    job.item_value_cents > fees.itemValueCapCents &&
    !job.needs_value_approval
  ) {
    throw new Error("High-value requests must be flagged.");
  }
  return { job, privateJob };
}
