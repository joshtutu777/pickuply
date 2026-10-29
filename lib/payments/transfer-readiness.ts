const NEW_DRIVER_HOLD_MS = 48 * 60 * 60 * 1000;
const ESTABLISHED_DRIVER_JOBS = 5;

export type TransferReadiness =
  | "send"
  | "hold_new_driver"
  | "hold_dispute"
  | "needs_payout_setup"
  | "already_sent"
  | "wait";

/**
 * Whether a completed job can be transferred now.
 * `chargeAvailableOn` is accepted and ignored: a transfer that names the job charge
 * does not wait for that charge to become available.
 */
export function transferReadiness(input: {
  payable: boolean;
  completedAt: Date;
  now: Date;
  completedJobCount: number;
  disputeHold: boolean;
  payoutsEnabled: boolean;
  transfersActive: boolean;
  alreadyTransferred: boolean;
  chargeAvailableOn?: Date | null;
}): TransferReadiness {
  if (input.alreadyTransferred) return "already_sent";
  if (input.disputeHold) return "hold_dispute";
  if (!input.payoutsEnabled || !input.transfersActive) return "needs_payout_setup";
  if (!input.payable) return "wait";
  const ageMs = input.now.getTime() - input.completedAt.getTime();
  if (input.completedJobCount < ESTABLISHED_DRIVER_JOBS && ageMs < NEW_DRIVER_HOLD_MS) return "hold_new_driver";
  return "send";
}

/** Stripe's recipient transfers capability is ready only when its status is active. */
export function transfersCapabilityActive(status: string | null | undefined): boolean {
  return status === "active";
}

/** A refused transfer for a missing capability stays on the same ledger id. It is not a failed payout. */
export function missingTransfersCapability(error: unknown): boolean {
  const record = error && typeof error === "object" ? (error as { code?: unknown; message?: unknown }) : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  return /insufficient_capabilities_for_transfer/i.test(`${code} ${message}`);
}
