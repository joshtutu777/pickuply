import "server-only";

import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type RefundStart = {
  outcome: "release" | "refund";
  payment_intent_id?: string | null;
  refund_id?: string;
  charge_id?: string;
  amount_cents?: number;
};

export async function requestRefund(jobId: string, amountCents: number, reason: string): Promise<void> {
  const user = await createClient();
  const started = await user.rpc("begin_refund", {
    target_job: jobId,
    amount_cents: amountCents,
    reason,
  });
  if (started.error || !started.data) {
    throw new Error(started.error?.message ?? "The refund could not be started.");
  }
  const row = started.data as RefundStart;
  const stripe = getStripe();
  const service = createServiceClient();

  if (row.outcome === "release") {
    if (!row.payment_intent_id) throw new Error("The card hold could not be found.");
    const intent = await stripe.paymentIntents.retrieve(row.payment_intent_id);
    if (intent.status !== "canceled") {
      await stripe.paymentIntents.cancel(row.payment_intent_id, {}, { idempotencyKey: `cancel:${row.payment_intent_id}` });
    }
    const noted = await service.rpc("note_authorization_canceled", {
      target_job: jobId,
      payment_intent: row.payment_intent_id,
    });
    if (noted.error) throw new Error("The card hold was released, but it could not be recorded.");
    return;
  }

  if (!row.refund_id || !row.charge_id || !row.amount_cents) {
    throw new Error("The refund could not be started.");
  }
  try {
    const refund = await stripe.refunds.create(
      {
        charge: row.charge_id,
        amount: row.amount_cents,
        reverse_transfer: false,
        metadata: { refund_id: row.refund_id },
      },
      { idempotencyKey: `refund:${row.refund_id}` },
    );
    const applied = await service.rpc("apply_refund", {
      target_refund: row.refund_id,
      stripe_refund_id: refund.id,
      succeeded: refund.status !== "failed",
    });
    if (applied.error) throw new Error("The refund could not be recorded.");
  } catch (error) {
    await service.rpc("apply_refund", {
      target_refund: row.refund_id,
      stripe_refund_id: null,
      succeeded: false,
    });
    throw error;
  }
}

export async function reverseTransferForRecovery(obligationId: string, transferId: string, reason: string): Promise<void> {
  const reversal = await getStripe().transfers.createReversal(transferId, {}, { idempotencyKey: `reversal:${obligationId}` });
  if (!reversal.id) throw new Error("Stripe did not reverse the transfer.");
  const user = await createClient();
  const marked = await user.rpc("mark_recovery", {
    target_obligation: obligationId,
    method: "reversal",
    reason,
  });
  if (marked.error) throw new Error(marked.error.message);
}
