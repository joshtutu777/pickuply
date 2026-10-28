/** Platform payment webhook events. Connect account events use a separate destination. */
export const platformPaymentEvents = [
  "checkout.session.completed",
  "checkout.session.expired",
  "payment_intent.amount_capturable_updated",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "payment_intent.succeeded",
  "charge.captured",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "refund.created",
  "refund.updated",
  "charge.refunded",
] as const;

/** Connected-account events. These are not delivered to the platform payment endpoint. */
export const connectWebhookEvents = [
  "account.updated",
  "transfer.created",
  "transfer.updated",
  "transfer.reversed",
  "payout.paid",
  "payout.failed",
] as const;

export function isListedEvent(type: string, events: readonly string[]): boolean {
  return events.includes(type);
}
