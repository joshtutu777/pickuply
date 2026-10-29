import type Stripe from "stripe";
import { transferForLedger } from "@/lib/payments/transfer-match";

export type LedgerTransferRequest = {
  entryId: string;
  amountCents: number;
  destination: string;
  chargeId: string;
};

/** Lists by transfer group. Stripe Search does not support transfers. */
export async function findTransferByLedger(stripe: Stripe, entryId: string): Promise<string | null> {
  const listed = await stripe.transfers.list({ transfer_group: entryId, limit: 1 });
  return transferForLedger(listed.data, entryId);
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
