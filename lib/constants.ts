/**
 * Product constants for Pickuply.
 *
 * docs/SPEC.md was not in the repository during Step 1 (no commits, and
 * origin/main was gone). Service copy matches the Step 1 brief. Geographic
 * zones and dollar amounts stay unset until the spec is added.
 */

export const services = [
  {
    id: "pickup-delivery",
    name: "Pickup & Delivery",
    summary: "Facebook Marketplace finds, store pickups, single items",
  },
  {
    id: "free-item-pickups",
    name: "Free-Item Pickups",
    summary: "Grab free furniture before it's gone",
  },
  {
    id: "junk-removal",
    name: "Junk Removal & Hauling",
    summary:
      "Old furniture, junk, and yard debris. Send a photo and we'll get you a price.",
  },
  {
    id: "construction-deliveries",
    name: "Construction Store Deliveries",
    summary: "Home Depot, Lowe's, lumber yards",
  },
] as const;

export type ServiceId = (typeof services)[number]["id"];

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

export type Zone = {
  id: string;
  name: string;
  areas: readonly string[];
};

/** Service areas. Empty until docs/SPEC.md defines them. */
export const zones: readonly Zone[] = [];

/**
 * Pricing rules that are known without the spec.
 * `schedule` is null on purpose: do not invent dollar amounts here.
 */
export const fees = {
  currency: "USD",
  capture: "manual",
  chargedWhen: "after_delivery",
  driverPayouts: "v2_stripe_connect",
  schedule: null,
} as const;
