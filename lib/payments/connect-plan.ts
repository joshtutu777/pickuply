/** How /api/stripe/connect handles a verified event. Unknown types are ignored. */
export type ConnectWebhookAction = "account" | "transfer" | "payout" | "ignore";

export const connectWebhookSecretName = "STRIPE_CONNECT_WEBHOOK_SECRET";

export function connectWebhookAction(type: string): ConnectWebhookAction {
  if (type === "account.updated") return "account";
  if (type === "transfer.created" || type === "transfer.updated" || type === "transfer.reversed") return "transfer";
  if (type === "payout.paid" || type === "payout.failed") return "payout";
  return "ignore";
}

/** The bank-payout row status. A transfer is not a bank deposit. */
export function payoutRecordStatus(type: string): "paid" | "failed" | null {
  if (type === "payout.paid") return "paid";
  if (type === "payout.failed") return "failed";
  return null;
}
