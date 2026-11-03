import { paymentsMode, type PaymentsMode } from "@/lib/payments/payments-mode";

export const PAID_BOOKINGS_UNAVAILABLE = "Paid bookings are temporarily unavailable.";

export type CustomerChargeKind = "booking" | "tip";

/** Only the exact value true opens new live charges. Missing, blank, and every other value stay closed. */
export function paidBookingsEnabled(value: string | undefined): boolean {
  return value === "true";
}

/**
 * Decides whether a new customer charge may be created.
 * Test mode stays open so a local test charge can still be created.
 * A test customer or a test driver does not skip the live gate.
 */
export function newLiveChargeDecision(input: {
  paymentsMode: PaymentsMode;
  paidBookings: string | undefined;
  kind: CustomerChargeKind;
  isTestCustomer?: boolean;
  isTestDriver?: boolean;
}): "allow" | "block" {
  if (input.kind !== "booking" && input.kind !== "tip") return "block";
  if (input.paymentsMode !== "live") return "allow";
  const testProfile = input.isTestCustomer === true || input.isTestDriver === true;
  const enabled = paidBookingsEnabled(input.paidBookings);
  if (testProfile) return enabled ? "allow" : "block";
  return enabled ? "allow" : "block";
}

/** True when this server would refuse a new live customer charge. */
export function liveCustomerChargesPaused(
  modeValue: string | undefined = process.env.PAYMENTS_MODE,
  paidBookings: string | undefined = process.env.PAID_BOOKINGS_ENABLED,
): boolean {
  return (
    newLiveChargeDecision({
      paymentsMode: paymentsMode(modeValue),
      paidBookings,
      kind: "booking",
    }) === "block"
  );
}

/**
 * Runs the paid-booking gate, then the caller's existing validation, then the Stripe create.
 * The create function is not called when the gate is closed or validation fails.
 */
export async function placeCustomerCharge<T>(input: {
  paymentsMode: PaymentsMode;
  paidBookings: string | undefined;
  kind: CustomerChargeKind;
  isTestCustomer?: boolean;
  isTestDriver?: boolean;
  validationError?: string | null;
  create: () => Promise<T>;
}): Promise<T> {
  if (
    newLiveChargeDecision({
      paymentsMode: input.paymentsMode,
      paidBookings: input.paidBookings,
      kind: input.kind,
      isTestCustomer: input.isTestCustomer,
      isTestDriver: input.isTestDriver,
    }) === "block"
  ) {
    throw new Error(PAID_BOOKINGS_UNAVAILABLE);
  }
  if (input.validationError) throw new Error(input.validationError);
  return input.create();
}
