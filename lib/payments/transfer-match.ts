const ledgerId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LedgerTransfer = {
  id: string;
  transfer_group?: string | null;
  metadata?: { ledger_id?: string | null } | null;
};

export function isLedgerEntryId(value: string): boolean {
  return ledgerId.test(value);
}

/** The Stripe idempotency key stays the ledger id, so a retry cannot start a second transfer. */
export function transferIdempotencyKey(entryId: string): string | null {
  if (!isLedgerEntryId(entryId)) return null;
  return entryId;
}

export type TransferSearch = "found" | "absent" | "unknown";
export type TransferGateAction = "send" | "lookup" | "recorded" | "reconcile";

/** Decide the next transfer step without calling Stripe. A lost response never becomes a new key. */
export function nextTransferStep(action: TransferGateAction, located: TransferSearch): "record" | "create" | "confirm" | "wait" | "reconcile" {
  if (action === "recorded" || located === "found") return "record";
  if (action === "reconcile") return "reconcile";
  if (located === "unknown") return "wait";
  if (action === "send") return "create";
  if (action === "lookup") return "confirm";
  return "wait";
}

export type LookupErrorKind = "transient" | "configuration";

/** A key, permission, or account problem is not a retry. Other lookup errors can be tried again. */
export function lookupErrorKind(error: {
  type?: string;
  statusCode?: number;
  code?: string;
  message?: string;
} | null): LookupErrorKind {
  if (!error) return "transient";
  const type = error.type ?? "";
  const status = Number(error.statusCode ?? 0);
  const code = (error.code ?? "").toLowerCase();
  const message = (error.message ?? "").toLowerCase();
  if (type === "StripeAuthenticationError" || type === "StripePermissionError") return "configuration";
  if (status === 401 || status === 403) return "configuration";
  if (code.includes("api_key") || code.includes("permission") || code.includes("account_invalid") || code.includes("secret_key")) {
    return "configuration";
  }
  if (message.includes("invalid api key") || message.includes("permission") || message.includes("not allowed")) {
    return "configuration";
  }
  return "transient";
}

/**
 * A failed lookup retries twice. The third failure is reconciled and is not created.
 * A successful empty lookup is the only path that creates a transfer.
 */
export function lookupFailureAction(input: {
  attempts: number;
  kind: LookupErrorKind;
}): "retry" | "reconcile" | "alert" {
  if (input.kind === "configuration") return "alert";
  if (input.attempts < 3) return "retry";
  return "reconcile";
}

/** A transfer already recorded in Stripe for this ledger row. */
export function transferForLedger(rows: LedgerTransfer[], entryId: string): string | null {
  if (!isLedgerEntryId(entryId)) return null;
  const match = rows.find((row) => {
    if (!row.id.startsWith("tr_")) return false;
    if (row.transfer_group && row.transfer_group !== entryId) return false;
    return row.transfer_group === entryId || row.metadata?.ledger_id === entryId;
  });
  return match?.id ?? null;
}

/** Prefer the transfer-group hit. A legacy transfer has no group and is matched by ledger metadata. */
export function selectLedgerTransfer(
  grouped: LedgerTransfer[],
  destinationRows: LedgerTransfer[],
  entryId: string,
): string | null {
  return transferForLedger(grouped, entryId) ?? transferForLedger(destinationRows, entryId);
}
