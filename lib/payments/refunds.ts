import "server-only";

import { alertPaymentsIssue } from "@/lib/payments/mode-alert";
import { getStripeForRecordedMode } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type RefundStart = {
  outcome: "release" | "refund";
  payment_intent_id?: string | null;
  refund_id?: string;
  charge_id?: string;
  amount_cents?: number;
};

export async function requestRefund(
  jobId: string,
  amountCents: number,
  reason: string,
  includeServiceFee = false,
): Promise<void> {
  const service = createServiceClient();
  const payment = await service.from("job_payments").select("charge_id, stripe_livemode").eq("job_id", jobId).maybeSingle();
  if (payment.error) throw new Error("The refund could not be started.");
  if (typeof payment.data?.stripe_livemode !== "boolean") {
    throw new Error("This payment has no recorded Stripe mode.");
  }
  const stripe = getStripeForRecordedMode(payment.data.stripe_livemode);
  if (payment.data?.charge_id) {
    const charge = await stripe.charges.retrieve(payment.data.charge_id);
    if (charge.livemode !== payment.data.stripe_livemode) {
      await alertPaymentsIssue(
        `refund-mode:${charge.id}`,
        "Refund mode mismatch",
        "The Stripe charge does not match the mode saved for this booking. The card was left unchanged.",
      );
      throw new Error("This payment does not match its saved Stripe mode.");
    }
  }
  const user = await createClient();
  const started = await user.rpc("begin_refund", {
    target_job: jobId,
    amount_cents: amountCents,
    reason,
    include_service_fee: includeServiceFee,
  });
  if (started.error || !started.data) {
    throw new Error(started.error?.message ?? "The refund could not be started.");
  }
  const row = started.data as RefundStart;

  if (row.outcome === "release") {
    if (!row.payment_intent_id) throw new Error("The card hold could not be found.");
    const intent = await stripe.paymentIntents.retrieve(row.payment_intent_id);
    if (intent.livemode !== payment.data.stripe_livemode) {
      await alertPaymentsIssue(
        `release-mode:${intent.id}`,
        "Card hold mode mismatch",
        "The card hold does not match the mode saved for this booking. It was left unchanged.",
      );
      throw new Error("This payment does not match its saved Stripe mode.");
    }
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
  const transferLookup = await createServiceClient()
    .from("ledger_entries")
    .select("job_id")
    .eq("stripe_transfer_id", transferId)
    .maybeSingle();
  if (transferLookup.error || !transferLookup.data?.job_id) {
    throw new Error("This transfer has no recorded booking.");
  }
  const payment = await createServiceClient()
    .from("job_payments")
    .select("stripe_livemode")
    .eq("job_id", transferLookup.data.job_id)
    .maybeSingle();
  if (typeof payment.data?.stripe_livemode !== "boolean") {
    throw new Error("This payment has no recorded Stripe mode.");
  }
  const stripe = getStripeForRecordedMode(payment.data.stripe_livemode);
  const transfer = await stripe.transfers.retrieve(transferId);
  if (transfer.livemode !== payment.data.stripe_livemode) {
    await alertPaymentsIssue(
      `reversal-mode:${transfer.id}`,
      "Transfer reversal mode mismatch",
      "The transfer does not match the mode saved for this booking. It was left unchanged.",
    );
    throw new Error("This transfer does not match its saved Stripe mode.");
  }
  const reversal = await stripe.transfers.createReversal(transferId, {}, { idempotencyKey: `reversal:${obligationId}` });
  if (!reversal.id) throw new Error("Stripe did not reverse the transfer.");
  const user = await createClient();
  const marked = await user.rpc("mark_recovery", {
    target_obligation: obligationId,
    method: "reversal",
    reason,
  });
  if (marked.error) throw new Error(marked.error.message);
}
