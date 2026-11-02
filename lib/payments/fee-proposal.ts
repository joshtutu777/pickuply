import { defaultFeeSettings, offerBreakdown, percentOfCents, type FeeSettings } from "@/lib/fees";

/**
 * Internal estimate only. Checkout charges the offer plus the 5% service fee.
 * Pickuply absorbs Stripe's processing cost. This helper estimates that cost
 * from the stored card rate, 2.9% plus 30 cents by default, on the offer.
 * It is not added to the customer total, and it is not the service fee.
 */
export function feeProposal(offerCents: number, settings: FeeSettings = defaultFeeSettings) {
  const current = offerBreakdown(offerCents, settings);
  const estimatedStripeFeeCents = percentOfCents(offerCents, settings.serviceBps ?? 0) + (settings.serviceFixedCents ?? 0);
  return {
    currentCustomerCents: current.customerTotalCents,
    proposedCustomerCents: offerCents,
    driverEarningsCents: current.driverEarningsCents,
    commissionCents: current.platformFeeCents,
    estimatedStripeFeeCents,
    estimatedNetCents: current.platformFeeCents - estimatedStripeFeeCents,
  };
}
