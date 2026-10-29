/**
 * Decides how a missed test-mode webhook should be caught up.
 * The caller retrieves the PaymentIntent. It does not create or capture a charge.
 */
export type ReconcileAction = "skip" | "authorize" | "note_canceled" | "record_unpaid_cancel";

export function reconcilePaymentAction(input: {
  livemode: boolean;
  intentStatus: string;
  jobStatus: string;
  paymentStatus: string;
}): ReconcileAction {
  if (input.livemode) return "skip";
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
