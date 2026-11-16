export const marketplaceRemovalCodes = [
  "ready",
  "needs_stripe",
  "removed",
  "already_removed",
  "not_posted",
  "has_driver",
  "has_payment",
  "has_dispute",
  "payment_changed",
  "stripe_active",
  "stripe_unverified",
] as const;

export type MarketplaceRemovalCode = (typeof marketplaceRemovalCodes)[number];

export function marketplaceRemovalMessage(code: string): string {
  switch (code) {
    case "removed":
      return "This request was removed from the marketplace. The record and its offers stay.";
    case "already_removed":
      return "This request is already off the marketplace.";
    case "not_posted":
      return "This request is not on the marketplace, so it was left as it is.";
    case "has_driver":
      return "A driver is assigned, so this request was not removed. The existing status tools still apply.";
    case "has_payment":
      return "This request has a payment, refund, or other money record, so it was not removed.";
    case "has_dispute":
      return "This request has a dispute, so it was not removed.";
    case "needs_stripe":
      return "This request has an old checkout that must be checked with Stripe before it can be removed.";
    case "payment_changed":
      return "A payment record changed while this was being checked, so the request was not removed.";
    case "stripe_active":
      return "Stripe still shows an open checkout, a card hold, or a charge, so the request was not removed.";
    case "stripe_unverified":
      return "The card record could not be checked with Stripe, so the request was not removed.";
    default:
      return "The request could not be removed from the marketplace.";
  }
}

export function isMarketplaceRemovalCode(value: string): value is MarketplaceRemovalCode {
  return (marketplaceRemovalCodes as readonly string[]).includes(value);
}
