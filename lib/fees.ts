/**
 * Booking fees in integer cents. supabase/migrations/0073_offer_commission.sql
 * uses this same arithmetic.
 *
 * The amount a driver or admin enters is the customer-facing offer.
 * Driver earnings = round half up(offer × (100% − commission)).
 * Pickuply commission = offer − driver earnings. It is not added again.
 * The customer pays the offer plus the card-processing amount only.
 * That processing amount is the smallest cent total whose separately rounded
 * percent plus the fixed amount still covers the offer.
 * Half-up: (numerator + denominator/2) / denominator for positive integers.
 */

export type FeeSettings = {
  platformBps: number;
  platformMinCents: number;
  serviceBps: number;
  serviceFixedCents: number;
};

export type PriceBreakdown = {
  driverEarningsCents: number;
  platformFeeCents: number;
  subtotalCents: number;
  serviceFeeCents: number;
  customerTotalCents: number;
};

export const defaultFeeSettings: FeeSettings = {
  platformBps: 1_500,
  platformMinCents: 0,
  serviceBps: 290,
  serviceFixedCents: 30,
};

export function roundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error("rounding needs positive integers");
  }
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

export function percentOfCents(cents: number, bps: number): number {
  return roundHalfUp(cents * bps, 10_000);
}

export function serviceChargeCents(customerTotalCents: number, settings: FeeSettings): number {
  return percentOfCents(customerTotalCents, settings.serviceBps) + settings.serviceFixedCents;
}

function smallestCoveredTotal(offerCents: number, settings: FeeSettings): number {
  const denominator = 10_000 - settings.serviceBps;
  let total = roundHalfUp((offerCents + settings.serviceFixedCents) * 10_000, denominator);
  if (total < offerCents) total = offerCents;
  while (
    total > offerCents &&
    total - 1 - serviceChargeCents(total - 1, settings) >= offerCents
  ) {
    total -= 1;
  }
  while (total - serviceChargeCents(total, settings) < offerCents) {
    total += 1;
  }
  return total;
}

/** The entered amount is the customer-facing offer, not driver take-home pay. */
export function offerBreakdown(
  offerCents: number,
  settings: FeeSettings = defaultFeeSettings,
): PriceBreakdown {
  if (!Number.isInteger(offerCents) || offerCents <= 0) {
    throw new Error("offer amount must be a positive number of cents");
  }
  if (!Number.isInteger(settings.platformBps) || settings.platformBps < 0 || settings.platformBps >= 10_000) {
    throw new Error("commission rate is not valid");
  }
  const driverEarningsCents = percentOfCents(offerCents, 10_000 - settings.platformBps);
  if (driverEarningsCents <= 0) {
    throw new Error("driver earnings would be zero");
  }
  const total = smallestCoveredTotal(offerCents, settings);
  return {
    driverEarningsCents,
    platformFeeCents: offerCents - driverEarningsCents,
    subtotalCents: offerCents,
    serviceFeeCents: total - offerCents,
    customerTotalCents: total,
  };
}

/** @deprecated The argument is the customer-facing offer. */
export function forwardFromEarnings(
  offerCents: number,
  settings: FeeSettings = defaultFeeSettings,
): PriceBreakdown {
  return offerBreakdown(offerCents, settings);
}

/** A posted price is the customer-facing offer. Processing is added on top. */
export function acceptFixedPrice(
  offerCents: number,
  settings: FeeSettings = defaultFeeSettings,
): PriceBreakdown {
  return offerBreakdown(offerCents, settings);
}
