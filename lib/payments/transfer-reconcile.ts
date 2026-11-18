import "server-only";

import type Stripe from "stripe";
import { getStripeForRecordedMode } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { transferPorts } from "./transfer-ports";
import { settleOneTransfer } from "./transfer-settle";
import type { TransferCreator, TransferSearch } from "./transfer-stripe";

export type ReconciliationReport = {
  recorded: number;
  unresolved: { entryId: string; reason: string }[];
  error: string | null;
};

type ClaimRow = { ledger_id: string; state: string };

// Manual recovery only. This is not scheduled and must not be added to vercel.json.
export async function reconcileUnresolvedTransfers(): Promise<ReconciliationReport> {
  const supabase = createServiceClient();
  const claims = await supabase
    .from("stripe_transfer_claims")
    .select("ledger_id, state")
    .is("stripe_transfer_id", null)
    .in("state", ["ambiguous", "sending"])
    .limit(100);
  if (claims.error) {
    return { recorded: 0, unresolved: [], error: "Unresolved transfers could not be listed." };
  }

  const report: ReconciliationReport = { recorded: 0, unresolved: [], error: null };
  const clients = new Map<boolean, Stripe | null>();
  for (const claim of (claims.data ?? []) as ClaimRow[]) {
    const outcome = await reconcileClaim(supabase, clients, claim.ledger_id);
    if (outcome.recorded) report.recorded += 1;
    else report.unresolved.push({ entryId: claim.ledger_id, reason: outcome.reason });
  }
  return report;
}

async function reconcileClaim(
  supabase: ReturnType<typeof createServiceClient>,
  clients: Map<boolean, Stripe | null>,
  entryId: string,
): Promise<{ recorded: boolean; reason: string }> {
  const ledger = await supabase
    .from("ledger_entries")
    .select("id, amount_cents, driver_id, job_id, stripe_transfer_id")
    .eq("id", entryId)
    .maybeSingle();
  if (ledger.error || !ledger.data?.job_id || !ledger.data.driver_id) {
    return { recorded: false, reason: "The ledger row could not be read." };
  }
  const payment = await supabase
    .from("job_payments")
    .select("stripe_livemode")
    .eq("job_id", ledger.data.job_id)
    .maybeSingle();
  if (payment.error) {
    return { recorded: false, reason: "The payment mode could not be read." };
  }
  const livemode = payment.data?.stripe_livemode === true;
  const account = await supabase
    .from("driver_connect_accounts")
    .select("stripe_account_id, livemode")
    .eq("driver_id", ledger.data.driver_id)
    .eq("livemode", livemode)
    .maybeSingle();
  if (account.error || account.data?.livemode !== livemode || !account.data.stripe_account_id) {
    return { recorded: false, reason: "The driver account for this mode could not be read." };
  }
  const stripe = clientFor(clients, livemode);
  if (!stripe) return { recorded: false, reason: "The Stripe client for this mode is not configured." };

  const settled = await settleOneTransfer({
    entryId,
    amountCents: ledger.data.amount_cents ?? 0,
    destination: account.data.stripe_account_id,
    chargeId: "",
    paymentLivemode: livemode,
    accountLivemode: account.data.livemode === true,
    workerLivemode: livemode,
    ledgerTransferId: typeof ledger.data.stripe_transfer_id === "string" ? ledger.data.stripe_transfer_id : null,
    allowCreate: false,
    search: searchFor(stripe),
    creator: creatorFor(stripe),
    ports: transferPorts(supabase, entryId),
  });
  if (settled.outcome === "recorded") return { recorded: true, reason: "" };
  return { recorded: false, reason: "The transfer is still unresolved." };
}

function clientFor(clients: Map<boolean, Stripe | null>, livemode: boolean): Stripe | null {
  const existing = clients.get(livemode);
  if (existing !== undefined) return existing;
  try {
    const created = getStripeForRecordedMode(livemode);
    clients.set(livemode, created);
    return created;
  } catch {
    clients.set(livemode, null);
    return null;
  }
}

function searchFor(stripe: Stripe): TransferSearch {
  return {
    async list(params) {
      const listed = await stripe.transfers.list(params);
      return {
        has_more: listed.has_more,
        data: listed.data.map((item) => ({
          id: item.id,
          transfer_group: item.transfer_group,
          metadata: item.metadata,
        })),
      };
    },
  };
}

function creatorFor(stripe: Stripe): TransferCreator {
  return {
    create(params, options) {
      return stripe.transfers.create(params, options);
    },
  };
}
