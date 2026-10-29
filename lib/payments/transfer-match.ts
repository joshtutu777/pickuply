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

/** Three failed lookups, then create with the same idempotency key. Stripe deduplicates that key for about 24 hours. */
export function afterLookupFailure(attempts: number): "retry" | "create" {
  return attempts >= 3 ? "create" : "retry";
}

/** A transfer already recorded in Stripe for this ledger row. */
export function transferForLedger(rows: LedgerTransfer[], entryId: string): string | null {
  if (!isLedgerEntryId(entryId)) return null;
  const match = rows.find(
    (row) =>
      row.id.startsWith("tr_") &&
      (row.transfer_group === entryId || row.metadata?.ledger_id === entryId),
  );
  return match?.id ?? null;
}
