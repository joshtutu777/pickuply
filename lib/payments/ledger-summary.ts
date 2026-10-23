const earned = new Set([
  "pending",
  "held",
  "held_until_onboarding",
  "ready",
  "transferred",
  "externally_paid",
]);

const waiting = new Set(["pending", "held", "held_until_onboarding", "ready"]);

export type LedgerBucket = {
  completedCents: number;
  pendingCents: number;
  transferredCents: number;
};

/** Ledger rows only. An uncaptured card authorization is not an earning. */
export function ledgerBuckets(entries: { status: string; amount_cents: number }[]): LedgerBucket {
  let completedCents = 0;
  let pendingCents = 0;
  let transferredCents = 0;
  for (const entry of entries) {
    if (!earned.has(entry.status)) continue;
    completedCents += entry.amount_cents;
    if (waiting.has(entry.status)) pendingCents += entry.amount_cents;
    if (entry.status === "transferred") transferredCents += entry.amount_cents;
  }
  return { completedCents, pendingCents, transferredCents };
}
