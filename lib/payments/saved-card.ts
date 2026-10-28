import { formatCents } from "@/lib/money";

export const cardSaveDisclosure =
  "Your card is held for this booking and saved so you can add an optional tip in one tap. You won't be charged extra without your OK.";

/** Checkout always keeps the card for a later tip. A known Stripe customer is reused. */
export function bookingCheckoutCustomer(stripeCustomerId: string | null): {
  customer?: string;
  customer_creation?: "always";
  setup_future_usage: "off_session";
} {
  if (stripeCustomerId && /^cus_[A-Za-z0-9]+$/.test(stripeCustomerId)) {
    return { customer: stripeCustomerId, setup_future_usage: "off_session" };
  }
  return { customer_creation: "always", setup_future_usage: "off_session" };
}

export function cardBrandLabel(brand: string | null): string {
  const known: Record<string, string> = {
    visa: "Visa",
    mastercard: "Mastercard",
    amex: "American Express",
    discover: "Discover",
  };
  if (!brand) return "Card";
  return known[brand.toLowerCase()] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

export function tipOneTapQuestion(input: {
  amountCents: number;
  driverFirstName: string;
  brand: string | null;
  last4: string | null;
}): string | null {
  if (!input.last4 || !/^\d{4}$/.test(input.last4)) return null;
  const name = input.driverFirstName.trim() || "your driver";
  return `Tip ${formatCents(input.amountCents)} to ${name} with ${cardBrandLabel(input.brand)} •••• ${input.last4}?`;
}

/** One tap uses the booking card only while that same card is still saved. */
export function sameBookingCard(input: {
  intentCustomerId: string | null;
  intentPaymentMethodId: string | null;
  savedCustomerId: string | null;
  savedPaymentMethodId: string | null;
  detached: boolean;
}): boolean {
  if (input.detached) return false;
  if (!input.intentCustomerId || !/^cus_[A-Za-z0-9]+$/.test(input.intentCustomerId)) return false;
  if (!input.intentPaymentMethodId || !input.intentPaymentMethodId.startsWith("pm_")) return false;
  return (
    input.savedCustomerId === input.intentCustomerId &&
    input.savedPaymentMethodId === input.intentPaymentMethodId
  );
}

export function tipIdempotencyKey(jobId: string, tipId: string): string {
  return `tip:${jobId}:${tipId}`;
}

/** The off-session charge uses the booking card. A retry of the same tip reuses one Stripe key. */
export function savedTipCharge(input: {
  tipId: string;
  amountCents: number;
  customerId: string;
  paymentMethodId: string;
  jobId: string;
  driverId: string;
}): {
  idempotencyKey: string;
  amount: number;
  currency: "usd";
  customer: string;
  payment_method: string;
  off_session: true;
  confirm: true;
  metadata: { tip_id: string; job_id: string; driver_id: string };
} {
  return {
    idempotencyKey: tipIdempotencyKey(input.jobId, input.tipId),
    amount: input.amountCents,
    currency: "usd",
    customer: input.customerId,
    payment_method: input.paymentMethodId,
    off_session: true,
    confirm: true,
    metadata: { tip_id: input.tipId, job_id: input.jobId, driver_id: input.driverId },
  };
}

export type TipChargeDecision = "paid" | "authenticate" | "fallback" | "live" | "uncertain";

const cardFailureCodes = new Set([
  "card_declined",
  "expired_card",
  "incorrect_cvc",
  "incorrect_number",
  "insufficient_funds",
  "processing_error",
  "card_velocity_exceeded",
]);

/** A succeeded test charge is recorded once. Card failure opens Checkout. Anything unclear stops. */
export function decideTipCharge(input: {
  livemode?: boolean;
  status?: string | null;
  errorCode?: string | null;
  errorType?: string | null;
}): TipChargeDecision {
  if (input.livemode) return "live";
  if (input.status === "succeeded") return "paid";
  if (input.errorCode === "authentication_required" || input.status === "requires_action") return "authenticate";
  if (
    input.errorType === "card_error" ||
    (input.errorCode != null && cardFailureCodes.has(input.errorCode)) ||
    input.status === "requires_payment_method" ||
    input.status === "canceled"
  ) {
    return "fallback";
  }
  return "uncertain";
}

/** Checkout is safe only after the off-session attempt is canceled and nothing was collected. */
export function tipFallbackAllowed(release: "canceled" | "paid" | "blocked"): boolean {
  return release === "canceled";
}
