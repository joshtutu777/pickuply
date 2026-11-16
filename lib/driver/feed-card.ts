import { itemSizes, services } from "@/lib/constants";
import { cityFromArea } from "@/lib/jobs/next-action";
import { formatCents } from "@/lib/money";

export const detailsButtonLabel = "View Details & Send Offer";
export const sentOfferButtonLabel = "View Request Details";
export const unavailableJobTitle = "This request is no longer available";
export const offerFieldLabel = "Your Offer ($)";
export const offerButtonLabel = "Submit Offer";

/** Written notes and street addresses stay off the open-job page. */
export const hiddenUntilAssigned =
  "The written description, customer instructions, and street address stay hidden until you are assigned.";

const vehicles: Record<string, string> = {
  pickup: "Pickup",
  van: "Van",
  suv: "SUV",
  car: "Car",
  box_truck: "Box truck",
  trailer: "Trailer",
};

const windows: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

export function jobTypeLabel(service: string): string {
  return services.find((item) => item.id === service)?.name ?? "Request";
}

export function itemSummary(pieces: number, size: string): string {
  const count = pieces === 1 ? "1 piece" : `${pieces} pieces`;
  const named = size.trim().replaceAll("_", " ");
  return named ? `${count} · ${named}` : count;
}

export function placeLabel(area: string | null, kind: "pickup" | "dropoff"): string {
  const named = area?.trim();
  if (named) return named;
  return kind === "dropoff" ? "No drop-off" : "Pickup area not listed";
}

export function tripDistanceLabel(miles: number | null): string {
  const value = miles == null ? null : Number(miles);
  if (value == null || !Number.isFinite(value)) return "Trip distance not listed";
  return `${value} mi trip`;
}

export function fromYouLabel(miles: number | null): string {
  const value = miles == null ? null : Number(miles);
  if (value == null || !Number.isFinite(value)) return "Distance from you not listed";
  return `About ${Math.round(value)} mi from you`;
}

export function vehicleNeedLabel(vehicle: string | null): string {
  if (!vehicle) return "Any vehicle";
  return vehicles[vehicle] ?? vehicle.replaceAll("_", " ");
}

export function peopleLabel(helpLoading: boolean): string {
  return helpLoading ? "2 people" : "1 person";
}

export function stairsLabel(stairsPickup: number, stairsDropoff: number | null): string {
  const drop = stairsDropoff ?? 0;
  if (stairsPickup === 0 && drop === 0) return "No stairs reported";
  if (stairsDropoff == null) return `${stairsPickup} flight${stairsPickup === 1 ? "" : "s"} at pickup`;
  return `${stairsPickup} at pickup, ${stairsDropoff} at drop-off`;
}

export function helperNeedLabel(helpLoading: boolean, stairsPickup: number, stairsDropoff: number | null): string {
  const people = helpLoading ? "Helper needed" : "No helper needed";
  return `${people} · ${stairsLabel(stairsPickup, stairsDropoff)}`;
}

export function routeLabel(pickup: string | null, dropoff: string | null): string {
  const from = cityFromArea(pickup) ?? placeLabel(pickup, "pickup");
  const to = dropoff ? (cityFromArea(dropoff) ?? placeLabel(dropoff, "dropoff")) : "No drop-off";
  return `${from} to ${to}`;
}

export function pickupTimeLabel(date: string, window: string | null): string {
  const when = date === "asap" ? "As soon as possible" : date;
  if (!window) return when;
  return `${when} · ${windows[window] ?? window.replaceAll("_", " ")}`;
}

export function sizeLabel(size: string): string {
  return itemSizes.find((item) => item.id === size)?.label ?? (size.trim() ? size.replaceAll("_", " ") : "Size not listed");
}

export type StructuredItem = {
  type: string;
  quantity: string;
  size: string;
  handling: string;
};

/** Facts an eligible driver can already see. This does not include the written description. */
export function structuredItemFacts(input: {
  service: string;
  pieces: number;
  size: string;
  helpLoading: boolean;
  stairsPickup: number;
  stairsDropoff: number | null;
  elevator: boolean;
}): StructuredItem {
  const handling = [
    peopleLabel(input.helpLoading),
    stairsLabel(input.stairsPickup, input.stairsDropoff),
    input.elevator ? "Elevator available" : "No elevator reported",
  ].join(" · ");
  return {
    type: jobTypeLabel(input.service),
    quantity: input.pieces === 1 ? "1 piece" : `${input.pieces} pieces`,
    size: sizeLabel(input.size),
    handling,
  };
}

export function itemPhotoLabel(count: number): string | null {
  return count > 0 ? null : "No item photos";
}

export type StoredOffer = {
  jobId: string;
  status: string;
  driverAmountCents: number;
  platformFeeCents: number;
  createdAt: string;
};

export function offerAmountCents(driverAmountCents: number, platformFeeCents: number): number {
  return driverAmountCents + platformFeeCents;
}

export function latestOfferByJob(offers: StoredOffer[]): Map<string, StoredOffer> {
  const chosen = new Map<string, StoredOffer>();
  for (const offer of offers) {
    const current = chosen.get(offer.jobId);
    if (!current || offer.createdAt > current.createdAt) chosen.set(offer.jobId, offer);
  }
  return chosen;
}

export function offerStatusLabel(status: string): string | null {
  if (status === "active") return "Offer Sent";
  if (status === "chosen") return "Offer Chosen";
  if (status === "expired") return "Offer Expired";
  if (status === "withdrawn") return "Offer Withdrawn";
  if (status === "declined") return "Offer Declined";
  return null;
}

export function offerCardLine(status: string, amountCents: number): string | null {
  const label = offerStatusLabel(status);
  if (!label || !Number.isSafeInteger(amountCents)) return null;
  return `${label} — ${formatCents(amountCents)}`;
}

export function cardButtonLabel(hasOffer: boolean): string {
  return hasOffer ? sentOfferButtonLabel : detailsButtonLabel;
}

/** The form needs an amount before review. The database still enforces the service minimum. */
export function offerDraftReady(cents: number): boolean {
  return Number.isSafeInteger(cents) && cents > 0;
}

/** The alerts badge. Ten or more unread notifications show as 9+. Zero shows nothing. */
export function notificationBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const whole = Math.floor(count);
  return whole > 9 ? "9+" : String(whole);
}
