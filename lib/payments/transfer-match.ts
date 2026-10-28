const ledgerId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LedgerTransfer = {
  id: string;
  metadata?: { ledger_id?: string | null } | null;
};

export function isLedgerEntryId(value: string): boolean {
  return ledgerId.test(value);
}

/** A transfer already recorded in Stripe for this ledger row, if the search result includes it. */
export function transferForLedger(rows: LedgerTransfer[], entryId: string): string | null {
  if (!isLedgerEntryId(entryId)) return null;
  const match = rows.find((row) => row.id.startsWith("tr_") && row.metadata?.ledger_id === entryId);
  return match?.id ?? null;
}
