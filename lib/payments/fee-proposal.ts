import { defaultFeeSettings, offerBreakdown, percentOfCents, type FeeSettings } from "@/lib/fees";

/**
 * Proposal only. Checkout still uses offerBreakdown, which adds card processing
 * on top of the offer. This estimate uses the configured 2.9% plus 30 cents on
 * the offer itself. It is not a Stripe balance-transaction fee.
 */
export function feeProposal(offerCents: number, settings: FeeSettings = defaultFeeSettings) {
  const current = offerBreakdown(offerCents, settings);
  const estimatedStripeFeeCents = percentOfCents(offerCents, settings.serviceBps) + settings.serviceFixedCents;
  return {
    currentCustomerCents: current.customerTotalCents,
    proposedCustomerCents: offerCents,
    driverEarningsCents: current.driverEarningsCents,
    commissionCents: current.platformFeeCents,
    estimatedStripeFeeCents,
    estimatedNetCents: current.platformFeeCents - estimatedStripeFeeCents,
  };
}
