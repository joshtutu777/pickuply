import { paymentsMode, type PaymentsMode } from "@/lib/payments/payments-mode";

export const PAID_BOOKINGS_UNAVAILABLE = "Online payment is temporarily unavailable. Please try again shortly.";

/** Only the exact value true opens new live charges. Missing, blank, and every other value stay closed. */
export function paidBookingsEnabled(value: string | undefined): boolean {
  return value === "true";
}

/**
 * Decides whether a new customer charge may be created.
 * Test mode stays open so a local test charge can still be created.
 * A test customer does not skip the live gate.
 */
export function newLiveChargeDecision(input: {
  paymentsMode: PaymentsMode;
  paidBookings: string | undefined;
}): "allow" | "block" {
  if (input.paymentsMode !== "live") return "allow";
  if (paidBookingsEnabled(input.paidBookings)) return "allow";
  return "block";
}

/** True when this server would refuse a new live customer charge. */
export function liveCustomerChargesPaused(
  modeValue: string | undefined = process.env.PAYMENTS_MODE,
  paidBookings: string | undefined = process.env.PAID_BOOKINGS_ENABLED,
): boolean {
  return newLiveChargeDecision({
    paymentsMode: paymentsMode(modeValue),
    paidBookings,
  }) === "block";
}
