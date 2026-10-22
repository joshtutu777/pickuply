/**
 * Booking fees in integer cents. The database functions in
 * supabase/migrations/0008_admin_publish.sql use this same arithmetic.
 *
 * Platform fee = max(round(platform percent × driver earnings), minimum).
 * Subtotal = driver earnings + platform fee.
 * Forward customer total is the smallest cent amount whose separately rounded
 * service percent plus the fixed service fee still covers the subtotal.
 * Fixed Accept keeps the posted customer total and solves backward.
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
  platformBps: 1_000,
  platformMinCents: 1_000,
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

export function platformFeeCents(earningsCents: number, settings: FeeSettings): number {
  return Math.max(percentOfCents(earningsCents, settings.platformBps), settings.platformMinCents);
}

export function serviceChargeCents(customerTotalCents: number, settings: FeeSettings): number {
  return percentOfCents(customerTotalCents, settings.serviceBps) + settings.serviceFixedCents;
}

function smallestCoveredTotal(subtotalCents: number, settings: FeeSettings): number {
  const denominator = 10_000 - settings.serviceBps;
  let total = roundHalfUp((subtotalCents + settings.serviceFixedCents) * 10_000, denominator);
  if (total < subtotalCents) total = subtotalCents;
  while (
    total > subtotalCents &&
    total - 1 - serviceChargeCents(total - 1, settings) >= subtotalCents
  ) {
    total -= 1;
  }
  while (total - serviceChargeCents(total, settings) < subtotalCents) {
    total += 1;
  }
  return total;
}

export function splitSubtotal(
  subtotalCents: number,
  settings: FeeSettings,
): { driverEarningsCents: number; platformFeeCents: number } {
  const withMinimum = subtotalCents - settings.platformMinCents;
  if (withMinimum > 0 && platformFeeCents(withMinimum, settings) === settings.platformMinCents) {
    return {
      driverEarningsCents: withMinimum,
      platformFeeCents: settings.platformMinCents,
    };
  }

  let earnings = roundHalfUp(subtotalCents * 10_000, 10_000 + settings.platformBps);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const fee = platformFeeCents(earnings, settings);
    const gap = subtotalCents - (earnings + fee);
    if (gap === 0 && earnings > 0) {
      return { driverEarningsCents: earnings, platformFeeCents: fee };
    }
    earnings += gap;
  }
  throw new Error("could not split the subtotal");
}

/** Driver enters earnings. Fees are added on top. */
export function forwardFromEarnings(
  earningsCents: number,
  settings: FeeSettings = defaultFeeSettings,
): PriceBreakdown {
  if (!Number.isInteger(earningsCents) || earningsCents <= 0) {
    throw new Error("driver earnings must be a positive number of cents");
  }
  const platform = platformFeeCents(earningsCents, settings);
  const subtotal = earningsCents + platform;
  const total = smallestCoveredTotal(subtotal, settings);
  return {
    driverEarningsCents: earningsCents,
    platformFeeCents: platform,
    subtotalCents: subtotal,
    serviceFeeCents: total - subtotal,
    customerTotalCents: total,
  };
}

/** The posted customer total stays unchanged. Driver earnings absorb rounding pennies. */
export function acceptFixedPrice(
  customerTotalCents: number,
  settings: FeeSettings = defaultFeeSettings,
): PriceBreakdown {
  if (!Number.isInteger(customerTotalCents) || customerTotalCents <= 0) {
    throw new Error("customer total must be a positive number of cents");
  }
  const serviceFee = serviceChargeCents(customerTotalCents, settings);
  const subtotal = customerTotalCents - serviceFee;
  if (subtotal <= settings.platformMinCents) {
    throw new Error("driver earnings would be zero");
  }
  const split = splitSubtotal(subtotal, settings);
  if (split.driverEarningsCents <= 0) {
    throw new Error("driver earnings would be zero");
  }
  if (split.driverEarningsCents + split.platformFeeCents + serviceFee !== customerTotalCents) {
    throw new Error("price parts do not add up");
  }
  return {
    driverEarningsCents: split.driverEarningsCents,
    platformFeeCents: split.platformFeeCents,
    subtotalCents: subtotal,
    serviceFeeCents: serviceFee,
    customerTotalCents,
  };
}
