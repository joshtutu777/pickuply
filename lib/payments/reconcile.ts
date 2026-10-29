import { stripeObjectMatchesMode } from "@/lib/payments/object-mode";
import type { PaymentsMode } from "@/lib/payments/payments-mode";

/**
 * Decides how a missed webhook should be caught up. A mode mismatch is reported and left unchanged.
 * The caller retrieves the PaymentIntent. It does not create or capture a charge.
 */
export type ReconcileAction =
  | "skip"
  | "skip_closed"
  | "authorize"
  | "note_canceled"
  | "record_unpaid_cancel"
  | "report_mismatch";

const closedJob = new Set(["cancelled", "canceled", "completed", "expired"]);
const closedPayment = new Set(["canceled", "none", "captured", "paid"]);

/** A booking that must not be brought back because Stripe still has a hold. */
export function bookingClosedForReconcile(input: {
  jobStatus: string;
  paymentStatus: string;
  paymentDueAt: string | null;
  now: string;
}): boolean {
  if (closedJob.has(input.jobStatus) || closedPayment.has(input.paymentStatus)) return true;
  const waiting = input.paymentStatus === "awaiting_payment" || input.paymentStatus === "failed";
  return waiting && input.paymentDueAt != null && input.paymentDueAt < input.now;
}

export function reconcilePaymentAction(input: {
  paymentsMode?: PaymentsMode;
  livemode: boolean;
  intentStatus: string;
  jobStatus: string;
  paymentStatus: string;
  paymentDueAt: string | null;
  now: string;
}): ReconcileAction {
  if (!stripeObjectMatchesMode(input.paymentsMode ?? "test", input.livemode)) return "report_mismatch";
  if (input.intentStatus === "requires_capture" && bookingClosedForReconcile(input)) return "skip_closed";
  const openJob = ["assigned", "en_route", "arrived", "item_check", "in_transit", "delivered"].includes(input.jobStatus);
  if (!openJob) return "skip";
  if (
    input.intentStatus === "requires_capture" &&
    input.jobStatus === "assigned" &&
    (input.paymentStatus === "awaiting_payment" || input.paymentStatus === "failed")
  ) {
    return "authorize";
  }
  if (input.intentStatus === "canceled" && input.paymentStatus === "authorized") return "note_canceled";
  if (
    input.intentStatus === "canceled" &&
    (input.paymentStatus === "awaiting_payment" || input.paymentStatus === "failed")
  ) {
    return "record_unpaid_cancel";
  }
  return "skip";
}
