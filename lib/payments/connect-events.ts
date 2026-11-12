import "server-only";

import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/service";

export async function recordTransferEvent(event: Stripe.Event): Promise<void> {
  const transfer = event.data.object as Stripe.Transfer;
  const status = event.type === "transfer.reversed" || transfer.reversed ? "reversed" : "created";
  const noted = await createServiceClient().rpc("note_transfer_status", {
    transfer_id: transfer.id,
    next_status: status,
  });
  if (noted.error) throw new Error("The transfer status could not be recorded.");
}

export async function recordPayoutEvent(event: Stripe.Event): Promise<void> {
  const payout = event.data.object as Stripe.Payout;
  const recorded = await createServiceClient().rpc("record_bank_payout", {
    account_id: event.account ?? "",
    payout_id: payout.id,
    payout_status: event.type === "payout.paid" ? "paid" : "failed",
    amount_cents: payout.amount,
  });
  if (recorded.error) throw new Error("The bank payout could not be recorded.");
}
