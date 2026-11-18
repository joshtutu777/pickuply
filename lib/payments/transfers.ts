import "server-only";

import type Stripe from "stripe";
import { getStripeForRecordedMode } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { transferPorts } from "./transfer-ports";
import { settleOneTransfer } from "./transfer-settle";
import type { TransferCreator, TransferSearch } from "./transfer-stripe";

type ReadyTransfer = {
  entry_id: string;
  amount_cents: number;
  driver_id: string;
  stripe_account_id: string;
  charge_id: string;
  job_id: string;
};

export async function sendReadyTransfers(): Promise<string | null> {
  const supabase = createServiceClient();
  const refreshed = await supabase.rpc("refresh_ledger_readiness");
  if (refreshed.error) return "The payout list could not be refreshed.";
  let limit: string | null = null;
  for (const livemode of [false, true]) {
    const ready = await supabase.rpc("ready_transfers", { target_livemode: livemode });
    if (ready.error) return "Transfers could not be listed.";
    const rows = (ready.data ?? []) as ReadyTransfer[];
    if (rows.length === 0) continue;
    let stripe: Stripe;
    try {
      stripe = getStripeForRecordedMode(livemode);
    } catch {
      limit = "The Stripe client for this mode is not configured.";
      continue;
    }
    for (const row of rows) {
      const modes = await recordedModes(supabase, row, livemode);
      if (!modes) continue;
      const settled = await settleOneTransfer({
        entryId: row.entry_id,
        amountCents: row.amount_cents,
        destination: row.stripe_account_id,
        chargeId: row.charge_id,
        paymentLivemode: modes.paymentLivemode,
        accountLivemode: modes.accountLivemode,
        workerLivemode: livemode,
        ledgerTransferId: null,
        allowCreate: true,
        search: searchFor(stripe),
        creator: creatorFor(stripe),
        ports: transferPorts(supabase, row.entry_id),
      });
      if (settled.limit) limit = settled.limit;
    }
  }
  return limit;
}

async function recordedModes(
  supabase: ReturnType<typeof createServiceClient>,
  row: ReadyTransfer,
  livemode: boolean,
): Promise<{ paymentLivemode: boolean; accountLivemode: boolean } | null> {
  const payment = await supabase
    .from("job_payments")
    .select("stripe_livemode")
    .eq("job_id", row.job_id)
    .maybeSingle();
  const account = await supabase
    .from("driver_connect_accounts")
    .select("livemode")
    .eq("driver_id", row.driver_id)
    .eq("stripe_account_id", row.stripe_account_id)
    .maybeSingle();
  if (payment.error || account.error || !account.data) return null;
  const paymentLivemode = payment.data?.stripe_livemode === true;
  const accountLivemode = account.data.livemode === true;
  if (paymentLivemode !== livemode || accountLivemode !== livemode) return null;
  return { paymentLivemode, accountLivemode };
}

function searchFor(stripe: Stripe): TransferSearch {
  return {
    async list(params) {
      // Platform account for the saved mode. The connected account is the destination, not the caller.
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
