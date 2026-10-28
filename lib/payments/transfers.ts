import "server-only";

import { getStripe } from "@/lib/stripe";
import { isLedgerEntryId, transferForLedger } from "@/lib/payments/transfer-match";
import { createServiceClient } from "@/lib/supabase/service";

type ReadyTransfer = {
  entry_id: string;
  amount_cents: number;
  driver_id: string;
  stripe_account_id: string;
  charge_id: string;
};

export async function sendReadyTransfers(): Promise<string | null> {
  const supabase = createServiceClient();
  const refreshed = await supabase.rpc("refresh_ledger_readiness");
  if (refreshed.error) return "The payout list could not be refreshed.";
  const ready = await supabase.rpc("ready_transfers");
  if (ready.error) return "Transfers could not be listed.";

  let limit: string | null = null;
  for (const row of (ready.data ?? []) as ReadyTransfer[]) {
    if (!isLedgerEntryId(row.entry_id)) continue;
    let transferId: string | null = null;
    try {
      const stripe = getStripe();
      try {
        let startingAfter: string | undefined;
        for (let page = 0; page < 5 && !transferId; page += 1) {
          const existing = await stripe.transfers.list({
            destination: row.stripe_account_id,
            limit: 100,
            starting_after: startingAfter,
          });
          transferId = transferForLedger(existing.data, row.entry_id);
          const last = existing.data.at(-1);
          if (!existing.has_more || !last) break;
          startingAfter = last.id;
        }
      } catch {
        transferId = null;
      }
      if (!transferId) {
        const transfer = await stripe.transfers.create(
          {
            amount: row.amount_cents,
            currency: "usd",
            destination: row.stripe_account_id,
            source_transaction: row.charge_id,
            metadata: { ledger_id: row.entry_id },
          },
          { idempotencyKey: row.entry_id },
        );
        transferId = transfer.id;
      }
      const marked = await supabase.rpc("mark_transferred", {
        target_entry: row.entry_id,
        transfer_id: transferId,
      });
      if (marked.error) throw new Error("The transfer could not be recorded.");
    } catch (error) {
      if (transferId) continue;
      const message = error instanceof Error ? error.message : "The transfer could not be sent.";
      if (/source_transaction|insufficient|balance/i.test(message)) limit = message.slice(0, 180);
      await supabase.rpc("mark_transfer_failed", {
        target_entry: row.entry_id,
        reason: message.slice(0, 300),
      });
    }
  }
  return limit;
}
