import "server-only";

import { getStripe } from "@/lib/stripe";
import {
  isLedgerEntryId,
  nextTransferStep,
  transferForLedger,
  transferIdempotencyKey,
  type LedgerTransfer,
  type TransferGateAction,
  type TransferSearch,
} from "@/lib/payments/transfer-match";
import { createServiceClient } from "@/lib/supabase/service";

type ReadyTransfer = {
  entry_id: string;
  amount_cents: number;
  driver_id: string;
  stripe_account_id: string;
  charge_id: string;
};

type TransferGate = {
  action: TransferGateAction;
  transfer_id: string | null;
  idempotency_key: string;
};

function responseLost(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const type = "type" in error ? String(error.type) : "";
  const status = "statusCode" in error ? Number(error.statusCode) : 0;
  return type === "StripeConnectionError" || status >= 500;
}

async function locateTransfer(entryId: string, destination: string): Promise<{ id: string | null; located: TransferSearch }> {
  const stripe = getStripe();
  try {
    const body = (await stripe.rawRequest("GET", "/v1/transfers/search", {
      query: `metadata['ledger_id']:'${entryId}' AND destination:'${destination}'`,
      limit: 1,
    })) as { data?: LedgerTransfer[] };
    const id = transferForLedger(body.data ?? [], entryId);
    return { id, located: id ? "found" : "absent" };
  } catch {
    return { id: null, located: "unknown" };
  }
}

async function beginTransfer(entryId: string, confirmAbsent: boolean): Promise<TransferGate | null> {
  const result = await createServiceClient().rpc("begin_transfer_send", {
    target_entry: entryId,
    confirm_absent: confirmAbsent,
  });
  if (result.error || !result.data) return null;
  return result.data as TransferGate;
}

export async function sendReadyTransfers(): Promise<string | null> {
  const supabase = createServiceClient();
  const refreshed = await supabase.rpc("refresh_ledger_readiness");
  if (refreshed.error) return "The payout list could not be refreshed.";
  const ready = await supabase.rpc("ready_transfers");
  if (ready.error) return "Transfers could not be listed.";

  let limit: string | null = null;
  for (const row of (ready.data ?? []) as ReadyTransfer[]) {
    if (!isLedgerEntryId(row.entry_id) || transferIdempotencyKey(row.entry_id) !== row.entry_id) continue;
    let gate = await beginTransfer(row.entry_id, false);
    if (!gate || gate.idempotency_key !== row.entry_id) continue;
    const located = await locateTransfer(row.entry_id, row.stripe_account_id);
    let step = nextTransferStep(gate.action, located.located);
    if (step === "confirm") {
      gate = await beginTransfer(row.entry_id, true);
      if (!gate || gate.idempotency_key !== row.entry_id) continue;
      step = nextTransferStep(gate.action, "absent");
    }
    const knownId = located.id ?? gate.transfer_id;
    if (step === "record" && knownId) {
      const marked = await supabase.rpc("record_claimed_transfer", {
        target_entry: row.entry_id,
        transfer_id: knownId,
      });
      if (marked.error) await supabase.rpc("note_transfer_unknown", { target_entry: row.entry_id });
      continue;
    }
    if (step !== "create") {
      if (step === "reconcile" || located.located === "unknown") {
        await supabase.rpc("note_transfer_unknown", { target_entry: row.entry_id });
      }
      continue;
    }

    try {
      const transfer = await getStripe().transfers.create(
        {
          amount: row.amount_cents,
          currency: "usd",
          destination: row.stripe_account_id,
          source_transaction: row.charge_id,
          metadata: { ledger_id: row.entry_id },
        },
        { idempotencyKey: gate.idempotency_key },
      );
      const marked = await supabase.rpc("record_claimed_transfer", {
        target_entry: row.entry_id,
        transfer_id: transfer.id,
      });
      if (marked.error) throw new Error("The transfer could not be recorded.");
    } catch (error) {
      await supabase.rpc("note_transfer_unknown", { target_entry: row.entry_id });
      if (responseLost(error)) continue;
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
