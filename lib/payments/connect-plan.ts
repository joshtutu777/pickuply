/** How /api/stripe/connect handles a verified event. Unknown types are ignored. */
export type ConnectWebhookAction = "account" | "transfer" | "payout" | "ignore";

export const connectWebhookSecretName = "STRIPE_CONNECT_WEBHOOK_SECRET";

export function connectWebhookAction(type: string): ConnectWebhookAction {
  if (type === "account.updated") return "account";
  if (type === "transfer.created" || type === "transfer.updated" || type === "transfer.reversed") return "transfer";
  if (type === "payout.paid" || type === "payout.failed") return "payout";
  return "ignore";
}

/** Stored when an account.updated event has no driver row. The webhook still returns 200. */
export const unknownDriverNote = "ignored — no matching driver";

export function accountMatch(input: { driverId: string | null; driverExists: boolean }): "save" | "ignore" {
  if (!input.driverId || !input.driverExists) return "ignore";
  return "save";
}

/** The bank-payout row status. A transfer is not a bank deposit. */
export function payoutRecordStatus(type: string): "paid" | "failed" | null {
  if (type === "payout.paid") return "paid";
  if (type === "payout.failed") return "failed";
  return null;
}
