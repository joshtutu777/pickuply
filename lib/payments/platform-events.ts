import "server-only";

import type Stripe from "stripe";
import { captureReadyPayment } from "@/lib/payments/capture";
import { getStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";

const handled = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "payment_intent.amount_capturable_updated",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "payment_intent.succeeded",
  "charge.captured",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "refund.created",
  "refund.updated",
  "charge.refunded",
]);

export function isPlatformPaymentEvent(type: string): boolean {
  return handled.has(type);
}

type ChargeCard = { capture_before?: number | null };

async function chargeDetails(intent: Stripe.PaymentIntent): Promise<{ id: string | null; captureBefore: string | null }> {
  const latest = intent.latest_charge;
  const id = typeof latest === "string" ? latest : latest?.id ?? null;
  if (!id) return { id: null, captureBefore: null };
  const charge = typeof latest === "object" && latest ? latest : await getStripe().charges.retrieve(id);
  const card = charge.payment_method_details?.card as ChargeCard | null | undefined;
  const unix = card?.capture_before ?? null;
  return { id, captureBefore: unix ? new Date(unix * 1000).toISOString() : null };
}

async function acceptOrRelease(intent: Stripe.PaymentIntent): Promise<void> {
  if (intent.status !== "requires_capture") return;
  const jobId = intent.metadata?.job_id;
  const driverId = intent.metadata?.driver_id;
  if (!jobId || !driverId) return;
  const charge = await chargeDetails(intent);
  const supabase = createServiceClient();
  const result = await supabase.rpc("apply_authorization", {
    target_job: jobId,
    payment_intent: intent.id,
    charge_id: charge.id,
    capture_before: charge.captureBefore,
    checkout_driver: driverId,
  });
  if (result.error) throw new Error(result.error.message);
  const marked = await supabase.rpc("note_stripe_livemode", { target_job: jobId, live: intent.livemode });
  if (marked.error) throw new Error(marked.error.message);
  if (result.data === "released_late" || result.data === "duplicate") {
    try {
      await getStripe().paymentIntents.cancel(intent.id, {}, { idempotencyKey: `cancel:${intent.id}` });
    } catch {
      const current = await getStripe().paymentIntents.retrieve(intent.id);
      if (current.status !== "canceled") throw new Error("The card hold could not be released.");
    }
  }
}

export async function handlePlatformPaymentEvent(event: Stripe.Event): Promise<void> {
  const stripe = getStripe();
  const supabase = createServiceClient();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!intentId) return;
    await acceptOrRelease(await stripe.paymentIntents.retrieve(intentId));
    return;
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    const jobId = session.metadata?.job_id;
    if (!jobId) return;
    const noted = await supabase.rpc("note_checkout_expired", {
      target_job: jobId,
      session_id: session.id,
    });
    if (noted.error) throw new Error("The expired checkout could not be recorded.");
    return;
  }

  if (event.type === "payment_intent.amount_capturable_updated") {
    await acceptOrRelease(event.data.object as Stripe.PaymentIntent);
    return;
  }

  if (event.type === "payment_intent.payment_failed") {
    const intent = event.data.object as Stripe.PaymentIntent;
    const jobId = intent.metadata?.job_id;
    if (!jobId) return;
    const failed = await supabase.rpc("mark_checkout_failed", {
      target_job: jobId,
      payment_intent: intent.id,
    });
    if (failed.error) throw new Error("The failed payment could not be recorded.");
    return;
  }

  if (event.type === "payment_intent.canceled") {
    const intent = event.data.object as Stripe.PaymentIntent;
    const jobId = intent.metadata?.job_id;
    if (!jobId) return;
    const noted = await supabase.rpc("note_authorization_canceled", {
      target_job: jobId,
      payment_intent: intent.id,
    });
    if (noted.error) throw new Error("The canceled authorization could not be recorded.");
    return;
  }

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object as Stripe.PaymentIntent;
    const jobId = intent.metadata?.job_id;
    if (jobId) await captureReadyPayment(jobId);
    return;
  }

  if (event.type === "charge.captured") {
    const charge = event.data.object as Stripe.Charge;
    const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (!intentId) return;
    const intent = await stripe.paymentIntents.retrieve(intentId);
    const jobId = intent.metadata?.job_id;
    if (jobId) await captureReadyPayment(jobId);
    return;
  }

  if (event.type.startsWith("charge.dispute.")) {
    const dispute = event.data.object as Stripe.Dispute;
    const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
    if (!chargeId) return;
    const payment = await supabase.from("job_payments").select("job_id").eq("charge_id", chargeId).maybeSingle();
    if (!payment.data?.job_id) return;
    if (event.type === "charge.dispute.created" || event.type === "charge.dispute.updated") {
      const recorded = await supabase.rpc("record_chargeback", {
        target_job: payment.data.job_id,
        dispute_id: dispute.id,
        dispute_status: dispute.status,
        amount_cents: dispute.amount,
      });
      if (recorded.error) throw new Error("The card dispute could not be recorded.");
    }
    if (event.type === "charge.dispute.closed") {
      const closed = await supabase.rpc("note_dispute_closed", {
        dispute_id: dispute.id,
        outcome: dispute.status === "won" ? "won" : "lost",
      });
      if (closed.error) throw new Error("The card dispute outcome could not be recorded.");
    }
    return;
  }

  if (event.type === "charge.refunded") return;

  if (event.type === "refund.created" || event.type === "refund.updated") {
    const refund = event.data.object as Stripe.Refund;
    const refundId = refund.metadata?.refund_id;
    if (!refundId || refund.status === "pending") return;
    const applied = await supabase.rpc("apply_refund", {
      target_refund: refundId,
      stripe_refund_id: refund.id,
      succeeded: refund.status === "succeeded",
    });
    if (applied.error) throw new Error("The refund could not be recorded.");
  }
}
