export type TransferLookupState = "found" | "absent" | "ambiguous" | "unavailable";

export type TransferGateAction = "send" | "lookup" | "recorded" | "reconcile";

export type TransferErrorClass = "temporary" | "funding" | "permanent" | "capability";

export type TransferFailureKind = "funding" | "permanent" | "uncertain";

export type TransferDecision =
  | { action: "record"; transferId: string }
  | { action: "create"; idempotencyKey: string }
  | { action: "refused"; kind: "funding" | "permanent" | "capability"; reason: string }
  | { action: "hold"; reason: string };

const LEDGER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSFER_ID = /^tr_[A-Za-z0-9]+$/;

export function isLedgerEntryId(value: string): boolean {
  return LEDGER_ID.test(value);
}

export function isTransferId(value: string | null | undefined): value is string {
  return typeof value === "string" && TRANSFER_ID.test(value);
}

export function classifyTransferError(error: unknown): TransferErrorClass {
  const record =
    typeof error === "object" && error !== null
      ? (error as { type?: unknown; statusCode?: unknown; code?: unknown; message?: unknown })
      : {};
  const type = typeof record.type === "string" ? record.type : "";
  const code = typeof record.code === "string" ? record.code : "";
  const status = typeof record.statusCode === "number" ? record.statusCode : 0;
  const message = typeof record.message === "string" ? record.message : "";
  if (code === "insufficient_capabilities_for_transfer") return "capability";
  if (
    type === "StripeConnectionError" ||
    type === "StripeAPIError" ||
    type === "StripeRateLimitError" ||
    type === "StripeAuthenticationError" ||
    type === "StripePermissionError" ||
    type === "StripeIdempotencyError"
  ) {
    return "temporary";
  }
  if (type === "StripeInvalidRequestError" || type === "StripeCardError") {
    return refusalClass(code, message);
  }
  if (status === 429 || status >= 500) return "temporary";
  if (status >= 400 && status < 500) return refusalClass(code, message);
  return "temporary";
}

function refusalClass(code: string, message: string): "funding" | "permanent" {
  if (/balance|insufficient|source_transaction/i.test(`${code} ${message}`)) return "funding";
  return "permanent";
}

export function recoverTransfer(input: {
  entryId: string;
  ledgerTransferId: string | null;
  paymentLivemode: boolean;
  accountLivemode: boolean;
  workerLivemode: boolean;
  gate: TransferGateAction | null;
  idempotencyKey: string | null;
  lookup: TransferLookupState;
  foundTransferId: string | null;
  allowCreate: boolean;
  failureKind: TransferFailureKind | null;
}): TransferDecision {
  if (!isLedgerEntryId(input.entryId)) {
    return { action: "hold", reason: "The ledger id is not valid." };
  }
  if (
    input.paymentLivemode !== input.workerLivemode ||
    input.accountLivemode !== input.workerLivemode
  ) {
    return { action: "hold", reason: "The payment mode does not match this transfer worker." };
  }
  if (isTransferId(input.ledgerTransferId)) {
    return { action: "record", transferId: input.ledgerTransferId };
  }
  if (input.lookup === "found") {
    if (!isTransferId(input.foundTransferId)) {
      return { action: "hold", reason: "The lookup did not return one transfer." };
    }
    return { action: "record", transferId: input.foundTransferId };
  }
  if (input.lookup === "ambiguous") {
    return { action: "hold", reason: "More than one Stripe transfer matches this ledger row." };
  }
  if (input.lookup === "unavailable") {
    return { action: "hold", reason: "Stripe lookup is unavailable." };
  }
  if (!input.allowCreate) {
    return { action: "hold", reason: "No transfer was found. Reconciliation will not create one." };
  }
  if (input.failureKind === "uncertain" || input.gate === "lookup" || input.gate === "reconcile") {
    return {
      action: "hold",
      reason: "The earlier Stripe result is unknown. An empty lookup is not enough to create another transfer.",
    };
  }
  if (input.failureKind === "funding" || input.failureKind === "permanent") {
    return {
      action: "hold",
      reason: "Stripe refused this transfer before accepting it. Another transfer needs manual resolution.",
    };
  }
  if (input.gate !== "send" || input.idempotencyKey !== input.entryId) {
    return { action: "hold", reason: "The stored idempotency key is not the ledger id." };
  }
  return { action: "create", idempotencyKey: input.entryId };
}

export function afterCreateResult(input: {
  kind: TransferErrorClass | "succeeded";
  transferId: string | null;
  message: string;
}): TransferDecision {
  if (input.kind === "succeeded" && isTransferId(input.transferId)) {
    return { action: "record", transferId: input.transferId };
  }
  if (input.kind === "capability") {
    return { action: "refused", kind: "capability", reason: "Stripe transfers are not active for this account." };
  }
  if (input.kind === "funding") {
    return {
      action: "refused",
      kind: "funding",
      reason: input.message.slice(0, 180) || "Stripe did not have funds for this transfer.",
    };
  }
  if (input.kind === "permanent") {
    return {
      action: "refused",
      kind: "permanent",
      reason: input.message.slice(0, 180) || "Stripe refused this transfer.",
    };
  }
  return {
    action: "hold",
    reason: "The Stripe response was lost or temporary. No second transfer will be created.",
  };
}
