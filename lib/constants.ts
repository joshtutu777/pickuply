/**
 * Pilot constants from docs/SPEC.md.
 * Zones are the seed list for the later zones table. Fees are the locked v1 policies.
 * Dollar amounts are integer cents.
 */

export const services = [
  {
    id: "delivery",
    name: "Pickup & Delivery",
    summary: "Facebook Marketplace finds, store pickups, single items",
  },
  {
    id: "free_item",
    name: "Free-Item Pickups",
    summary: "Grab free furniture before it's gone",
  },
  {
    id: "junk",
    name: "Junk Removal & Hauling",
    summary:
      "Old furniture, junk, and yard debris. Send a photo and we'll get you a price.",
  },
  {
    id: "construction",
    name: "Construction Store Deliveries",
    summary: "Home Depot, Lowe's, lumber yards",
  },
] as const;

export type ServiceId = (typeof services)[number]["id"];

export const serviceIds = services.map((service) => service.id);

export function serviceFromQuery(value: string | undefined): ServiceId | null {
  if (!value) return null;
  return services.some((service) => service.id === value)
    ? (value as ServiceId)
    : null;
}

export const driverTermsVersion = "driver-terms-v1";

export function serviceById(id: ServiceId) {
  const service = services.find((item) => item.id === id);
  if (!service) throw new Error(`Unknown service: ${id}`);
  return service;
}

export const zones = [
  {
    slug: "west_metro",
    name: "West Metro",
    areas: [
      "Austell",
      "Lithia Springs",
      "Smyrna",
      "Mableton",
      "Hiram",
      "SW Atlanta",
    ],
  },
  {
    slug: "east_gwinnett",
    name: "East Gwinnett",
    areas: [
      "Lawrenceville",
      "Snellville",
      "Loganville",
      "Buford",
      "Duluth",
      "Norcross",
    ],
  },
] as const;

export type ZoneSlug = (typeof zones)[number]["slug"];

export function zoneForCity(city: string): ZoneSlug | null {
  const normalized = city.trim().toLowerCase();
  if (!normalized) return null;
  for (const zone of zones) {
    if (zone.areas.some((area) => area.toLowerCase() === normalized)) {
      return zone.slug;
    }
  }
  return null;
}

export const howItWorks = [
  "Send a photo or listing",
  "Get a locked price",
  "A verified driver picks it up",
  "Pay only when it arrives",
] as const;

export const trustPoints = [
  "Verified drivers",
  "Price locked before pickup",
  "Card charged only after delivery",
] as const;

/** Locked v1 policies. Booking fees live in platform_settings. These defaults match that row and are not added on the request form. */
export const fees = {
  currency: "USD",
  minimumCents: 3_500,
  lateCancelFeeCents: 1_500,
  tripFeeCents: 2_500,
  damageCoverageLimitCents: 25_000,
  itemValueCapCents: 100_000,
  platformFeeRate: 0.1,
  platformFeeMinimumCents: 1_000,
  serviceFeeBps: 290,
  serviceFeeFixedCents: 30,
  capture: "manual",
  chargedWhen: "after_delivery",
  driverPayouts: "manual_zelle_or_cash_app",
} as const;

export const prohibitedItems = [
  "Hazardous materials",
  "Chemicals",
  "Propane tanks",
  "Paint or solvents (junk)",
  "Weapons",
  "Drugs",
  "Cash",
  "Live animals",
  "People",
  "Phones or small high-value electronics",
  "Jewelry",
] as const;

export const itemSizes = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
  { id: "xl", label: "Extra large" },
] as const;

export type ItemSize = (typeof itemSizes)[number]["id"];

export const junkLoadSizes = [
  { id: "single", label: "Single item" },
  { id: "quarter", label: "1/4 truck" },
  { id: "half", label: "1/2 truck" },
  { id: "full", label: "Full truck" },
] as const;

export type JunkLoadSize = (typeof junkLoadSizes)[number]["id"];

export const stairChoices = [
  { id: "0", label: "None" },
  { id: "1", label: "1 flight" },
  { id: "2", label: "2 flights" },
  { id: "3", label: "3+ flights" },
] as const;

export type StairChoice = (typeof stairChoices)[number]["id"];

export const timeWindows = [
  { id: "morning", label: "Morning" },
  { id: "afternoon", label: "Afternoon" },
  { id: "evening", label: "Evening" },
] as const;

export type TimeWindow = (typeof timeWindows)[number]["id"];

export const hearAboutOptions = [
  { id: "nextdoor", label: "Nextdoor" },
  { id: "facebook", label: "Facebook" },
  { id: "friend", label: "Friend" },
  { id: "landlord", label: "Landlord or property manager" },
  { id: "other", label: "Other" },
] as const;

export type HearAbout = (typeof hearAboutOptions)[number]["id"];

export const quotePricingCopy =
  "We'll review your request and send a custom price. This is not an instant guaranteed quote. Nothing is charged until you accept.";

export const driverPricingCopy =
  "Drivers can accept your price or send a counteroffer. You choose who to book. Nothing is charged until you accept.";

export const pricingMethods = [
  {
    id: "quote",
    label: "Get a quote",
    hint: quotePricingCopy,
  },
  {
    id: "fixed",
    label: "Name your price",
    hint: "One amount, at least $35.",
  },
  {
    id: "range",
    label: "Set a budget range",
    hint: "A minimum and a maximum.",
  },
] as const;

export type PricingMethod = (typeof pricingMethods)[number]["id"];

export const estimateMissingMessage =
  "We'll confirm a price after reviewing your request";

export const valueApprovalWarning =
  "Items over $1,000 need approval before booking.";

export const privacyAreaNote =
  "Drivers only see your general area until they're assigned.";

export const maxPhotos = 8;
export const photoMaxEdgePx = 1600;
export const photoMaxBytes = 5 * 1024 * 1024;
export const videoMaxSeconds = 30;
export const videoMaxBytes = 8 * 1024 * 1024;

export const requestSteps = [
  { id: "what", label: "What" },
  { id: "where", label: "Where and when" },
  { id: "price", label: "Your price" },
  { id: "verify", label: "Verify" },
] as const;

export type RequestStepId = (typeof requestSteps)[number]["id"];
