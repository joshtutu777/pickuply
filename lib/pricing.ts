import { fees } from "./constants";
import type { ItemSize, JunkLoadSize, ServiceId } from "./constants";

export type EstimateInput = {
  service: ServiceId | null;
  size: ItemSize | null;
  pieces: number | null;
  stairsPickup: number | null;
  stairsDropoff: number | null;
  helpLoading: boolean | null;
  junkLoadSize: JunkLoadSize | null;
};

export type EstimateRange = {
  minCents: number;
  maxCents: number;
};

/**
 * SPEC §7.2 customer-facing ranges. These are not driver pay.
 * The platform fee is not added here. Distance is assumed within 10 miles,
 * so the per-mile adder is not applied. Extra stops are not on this form.
 * "3+" flights are counted as 3 because the form does not collect a higher exact number.
 */
const LIGHT = { minCents: 3_500, maxCents: 6_000 };
const FULL_SINGLE = { minCents: 9_000, maxCents: 12_000 };
const FULL_MULTI = { minCents: 14_000, maxCents: 20_000 };
const STAIR_MIN = 1_500;
const STAIR_MAX = 2_500;

const JUNK: Record<JunkLoadSize, EstimateRange> = {
  single: { minCents: 5_000, maxCents: 7_500 },
  quarter: { minCents: 9_000, maxCents: 13_000 },
  half: { minCents: 15_000, maxCents: 22_000 },
  full: { minCents: 25_000, maxCents: 35_000 },
};

export function applyMinimumPrice(range: EstimateRange): EstimateRange {
  return {
    minCents: Math.max(fees.minimumCents, range.minCents),
    maxCents: Math.max(fees.minimumCents, range.maxCents),
  };
}

function withFlights(range: EstimateRange, flights: number): EstimateRange {
  if (flights <= 0) return range;
  return applyMinimumPrice({
    minCents: range.minCents + flights * STAIR_MIN,
    maxCents: range.maxCents + flights * STAIR_MAX,
  });
}

function deliveryRange(input: EstimateInput): EstimateRange | null {
  if (
    !input.size ||
    input.pieces == null ||
    input.pieces < 1 ||
    input.stairsPickup == null ||
    input.stairsDropoff == null ||
    input.helpLoading == null
  ) {
    return null;
  }

  const flights = input.stairsPickup + input.stairsDropoff;
  const smallEnough = input.size === "small" || input.size === "medium";
  const light = input.pieces === 1 && smallEnough && flights === 0 && input.helpLoading;

  if (input.pieces > 1) return withFlights(FULL_MULTI, flights);
  if (light) return applyMinimumPrice(LIGHT);
  return withFlights(FULL_SINGLE, flights);
}

function constructionRange(input: EstimateInput): EstimateRange | null {
  if (
    input.pieces == null ||
    input.pieces < 1 ||
    input.stairsPickup == null ||
    input.stairsDropoff == null
  ) {
    return null;
  }
  const flights = input.stairsPickup + input.stairsDropoff;
  const base = input.pieces > 1 ? FULL_MULTI : FULL_SINGLE;
  return withFlights(base, flights);
}

/** Typical range only. Never reads or changes the customer's pricing method or amounts. */
export function estimateRange(input: EstimateInput): EstimateRange | null {
  if (!input.service) return null;
  if (input.service === "junk") {
    if (!input.junkLoadSize) return null;
    return applyMinimumPrice(JUNK[input.junkLoadSize]);
  }
  if (input.service === "free_item") return applyMinimumPrice(LIGHT);
  if (input.service === "delivery") return deliveryRange(input);
  return constructionRange(input);
}
