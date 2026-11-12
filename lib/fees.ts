/**
 * Booking fees in integer cents. supabase/migrations/0073_offer_commission.sql
 * uses this same arithmetic.
 *
 * The amount a driver or admin enters is the customer-facing offer.
 * Driver earnings = round half up(offer × (100% − commission)).
 * Pickuply commission = offer − driver earnings. It comes out of the offer.
 * The customer pays that offer plus a marketplace service fee. The default is
 * 5% of the offer (500 basis points), rounded half up. It is not Stripe's fee.
 * Driver earnings stay 85% of the offer. Commission stays inside the offer.
 * platformMinCents is kept so older settings rows still load. It is not applied.
 * serviceBps and serviceFixedCents are the old card-processing settings. They
 * are not added to the customer total.
 * Half-up: (numerator + denominator/2) / denominator for positive integers.
 */

export type FeeSettings = {
  platformBps: number;
  platformMinCents: number;
  serviceFeeBps: number;
  /** Kept so older callers still load. Not added to the customer total. */
  serviceBps?: number;
  serviceFixedCents?: number;
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
  serviceFeeBps: 500,
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

export function serviceFeeCents(offerCents: number, settings: FeeSettings = defaultFeeSettings): number {
  if (!Number.isInteger(settings.serviceFeeBps) || settings.serviceFeeBps < 0 || settings.serviceFeeBps >= 10_000) {
    throw new Error("service fee rate is not valid");
  }
  return percentOfCents(offerCents, settings.serviceFeeBps);
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
  const fee = serviceFeeCents(offerCents, settings);
  return {
    driverEarningsCents,
    platformFeeCents: offerCents - driverEarningsCents,
    subtotalCents: offerCents,
    serviceFeeCents: fee,
    customerTotalCents: offerCents + fee,
  };
}

/** @deprecated The argument is the customer-facing offer. */
export function forwardFromEarnings(
  offerCents: number,
  settings: FeeSettings = defaultFeeSettings,
): PriceBreakdown {
  return offerBreakdown(offerCents, settings);
}

/** A posted price is the customer-facing offer. The service fee is added on top. */
export function acceptFixedPrice(
  offerCents: number,
  settings: FeeSettings = defaultFeeSettings,
): PriceBreakdown {
  return offerBreakdown(offerCents, settings);
}
