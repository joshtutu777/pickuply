import "server-only";

import { getStripe } from "@/lib/stripe";
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
    try {
      const transfer = await getStripe().transfers.create(
        {
          amount: row.amount_cents,
          currency: "usd",
          destination: row.stripe_account_id,
          source_transaction: row.charge_id,
          metadata: { ledger_id: row.entry_id },
        },
        { idempotencyKey: row.entry_id },
      );
      const marked = await supabase.rpc("mark_transferred", {
        target_entry: row.entry_id,
        transfer_id: transfer.id,
      });
      if (marked.error) throw new Error("The transfer could not be recorded.");
    } catch (error) {
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
