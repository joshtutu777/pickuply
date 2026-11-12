import type Stripe from "stripe";
import { selectLedgerTransfer, transferForLedger } from "@/lib/payments/transfer-match";

export type LedgerTransferRequest = {
  entryId: string;
  amountCents: number;
  destination: string;
  chargeId: string;
};

export type LegacyTransferSearch = {
  destination: string;
  createdAfter: Date;
};

/** Lists by transfer group, then by destination for transfers made before transfer groups existed. */
export async function findTransferByLedger(
  stripe: Stripe,
  entryId: string,
  legacy?: LegacyTransferSearch,
): Promise<string | null> {
  const grouped = await stripe.transfers.list({ transfer_group: entryId, limit: 1 });
  const groupedId = transferForLedger(grouped.data, entryId);
  if (groupedId || !legacy) return groupedId;
  const listed = await stripe.transfers.list({
    destination: legacy.destination,
    created: { gte: Math.floor(legacy.createdAfter.getTime() / 1000) },
    limit: 100,
  });
  return selectLedgerTransfer([], listed.data, entryId);
}

/** Creates one transfer. The ledger id is both the transfer group and the idempotency key. */
export async function createLedgerTransfer(stripe: Stripe, input: LedgerTransferRequest): Promise<string> {
  const transfer = await stripe.transfers.create(
    {
      amount: input.amountCents,
      currency: "usd",
      destination: input.destination,
      source_transaction: input.chargeId,
      transfer_group: input.entryId,
      metadata: { ledger_id: input.entryId },
    },
    { idempotencyKey: input.entryId },
  );
  return transfer.id;
}
