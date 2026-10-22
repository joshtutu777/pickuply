/** Rules mirrored by the database. Dump estimates are never added. */
export function captureCents(input: {
  kind: "full" | "trip";
  priceCents: number;
  tripFeeCents: number;
}): number {
  if (input.kind === "trip") return Math.min(input.tripFeeCents, input.priceCents);
  return input.priceCents;
}

export function ledgerAfterRefund(input: {
  transferred: boolean;
  ledgerCents: number;
  refundCents: number;
}): { ledgerCents: number; recoveryCents: number } {
  if (input.transferred) {
    return { ledgerCents: input.ledgerCents, recoveryCents: input.refundCents };
  }
  return {
    ledgerCents: Math.max(input.ledgerCents - input.refundCents, 0),
    recoveryCents: 0,
  };
}
