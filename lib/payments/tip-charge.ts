import "server-only";

import type Stripe from "stripe";
import {
  decideTipCharge,
  sameBookingCard,
  savedTipCharge,
  tipFallbackAllowed,
  tipIdempotencyKey,
} from "@/lib/payments/saved-card";
import { sendReadyTransfers } from "@/lib/payments/transfers";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export { tipIdempotencyKey };

export async function stripeFeeCents(intent: Stripe.PaymentIntent): Promise<number | null> {
  const latest = intent.latest_charge;
  const charge = typeof latest === "object" && latest ? latest : null;
  const balance = charge?.balance_transaction;
  if (!balance || typeof balance === "string") return null;
  return balance.fee;
}

export async function confirmTipFromIntent(intent: Stripe.PaymentIntent): Promise<void> {
  const tipId = intent.metadata?.tip_id;
  if (!tipId || intent.status !== "succeeded") return;
  if (intent.livemode) {
    await getStripe().refunds.create(
      { payment_intent: intent.id },
      { idempotencyKey: `tip-live-refund:${intent.id}` },
    ).catch(() => undefined);
    throw new Error("Live payments are not enabled.");
  }
  // A signed webhook lists the charge id. The fee is on the balance transaction, so retrieve it when the event did not expand it.
  const knownFee = await stripeFeeCents(intent);
  const expanded = knownFee != null
    ? intent
    : await getStripe().paymentIntents.retrieve(intent.id, { expand: ["latest_charge.balance_transaction"] });
  const fee = await stripeFeeCents(expanded);
  if (fee == null) throw new Error("The card fee is not available yet.");
  const charge = expanded.latest_charge;
  const chargeId = typeof charge === "string" ? charge : charge?.id ?? null;
  const confirmed = await createServiceClient().rpc("confirm_tip_payment", {
    target_tip: tipId,
    payment_intent: expanded.id,
    charge_id: chargeId,
    fee_cents: fee,
    live: false,
  });
  if (confirmed.error) throw new Error(confirmed.error.message);
  const jobId = expanded.metadata?.job_id;
  if (jobId) {
    try {
      await sendReadyTransfers({ jobId });
    } catch {
      // The 15-minute transfer job retries a row that is ready and not held.
    }
  }
}

export async function chargeSavedTip(input: {
  tipId: string;
  amountCents: number;
  customerId: string;
  paymentMethodId: string;
  jobId: string;
  driverId: string;
}): Promise<"paid" | "authenticate" | "fallback"> {
  if (!input.customerId.startsWith("cus_") || !input.paymentMethodId.startsWith("pm_")) return "fallback";
  const stripe = getStripe();
  const charge = savedTipCharge(input);
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: charge.amount,
        currency: charge.currency,
        customer: charge.customer,
        payment_method: charge.payment_method,
        off_session: charge.off_session,
        confirm: charge.confirm,
        metadata: charge.metadata,
        expand: ["latest_charge.balance_transaction"],
      },
      { idempotencyKey: charge.idempotencyKey },
    );
  } catch (error) {
    const failure = readTipFailure(error);
    const decision = decideTipCharge({
      livemode: failure.paymentIntent?.livemode,
      status: failure.paymentIntent?.status,
      errorCode: failure.code,
      errorType: failure.type,
    });
    if (decision === "live") {
      if (failure.paymentIntent?.status === "succeeded") {
        await stripe.refunds.create(
          { payment_intent: failure.paymentIntent.id },
          { idempotencyKey: `tip-live-refund:${failure.paymentIntent.id}` },
        ).catch(() => undefined);
      } else if (failure.paymentIntent?.id) {
        await stripe.paymentIntents.cancel(
          failure.paymentIntent.id,
          {},
          { idempotencyKey: `tip-cancel:${failure.paymentIntent.id}` },
        ).catch(() => undefined);
      }
      throw new Error("Live payments are not enabled.");
    }
    if (decision === "paid" && failure.paymentIntent) {
      await recordPaidTip(failure.paymentIntent);
      return "paid";
    }
    if (decision !== "authenticate" && decision !== "fallback") {
      throw new Error("The tip could not be charged.");
    }
    if (!failure.paymentIntent?.id) return decision;
    const released = await releaseTipIntent(failure.paymentIntent.id);
    if (released === "paid") return "paid";
    if (!tipFallbackAllowed(released)) throw new Error("The tip could not be charged.");
    return decision;
  }
  const decision = decideTipCharge({ livemode: intent.livemode, status: intent.status });
  if (decision === "live") {
    await stripe.refunds.create(
      { payment_intent: intent.id },
      { idempotencyKey: `tip-live-refund:${intent.id}` },
    ).catch(() => undefined);
    throw new Error("Live payments are not enabled.");
  }
  if (decision === "paid") {
    await recordPaidTip(intent);
    return "paid";
  }
  if (decision === "authenticate" || decision === "fallback") {
    const released = await releaseTipIntent(intent.id);
    if (released === "paid") return "paid";
    if (!tipFallbackAllowed(released)) throw new Error("The tip could not be charged.");
    return decision;
  }
  throw new Error("The tip could not be charged.");
}

/** A fallback charge waits until this attempt is canceled. A collected tip is recorded instead. */
async function releaseTipIntent(intentId: string): Promise<"canceled" | "paid" | "blocked"> {
  const stripe = getStripe();
  const finish = async (intent: Stripe.PaymentIntent): Promise<"canceled" | "paid" | "blocked"> => {
    if (intent.status === "canceled") return "canceled";
    if (intent.status === "succeeded") {
      await recordPaidTip(intent);
      return "paid";
    }
    return "blocked";
  };
  try {
    return await finish(await stripe.paymentIntents.cancel(
      intentId,
      {},
      { idempotencyKey: `tip-cancel:${intentId}` },
    ));
  } catch {
    try {
      return await finish(await stripe.paymentIntents.retrieve(intentId));
    } catch {
      return "blocked";
    }
  }
}

function readTipFailure(error: unknown): {
  code: string | null;
  type: string | null;
  paymentIntent: Stripe.PaymentIntent | null;
} {
  if (!error || typeof error !== "object") return { code: null, type: null, paymentIntent: null };
  const record = error as { code?: unknown; type?: unknown; payment_intent?: Stripe.PaymentIntent };
  return {
    code: typeof record.code === "string" ? record.code : null,
    type: typeof record.type === "string" ? record.type : null,
    paymentIntent: record.payment_intent ?? null,
  };
}

async function recordPaidTip(intent: Stripe.PaymentIntent): Promise<void> {
  try {
    await confirmTipFromIntent(intent);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Live payments are not enabled.")) throw error;
    throw new Error("The tip was charged and could not be recorded.");
  }
}

export type BookingCard = {
  customerId: string;
  paymentMethodId: string;
  brand: string | null;
  last4: string | null;
};

/** The card that authorized this job, when the customer has not removed it. */
export async function loadBookingCard(jobId: string, userId: string): Promise<BookingCard | null> {
  const supabase = await createClient();
  const owned = await supabase.from("jobs").select("customer_id").eq("id", jobId).maybeSingle();
  if (owned.data?.customer_id !== userId) return null;
  const payment = await createServiceClient()
    .from("job_payments")
    .select("stripe_payment_intent_id")
    .eq("job_id", jobId)
    .maybeSingle();
  const intentId = payment.data?.stripe_payment_intent_id;
  if (!intentId || !intentId.startsWith("pi_")) return null;
  let intent: Stripe.PaymentIntent;
  try {
    intent = await getStripe().paymentIntents.retrieve(intentId);
  } catch {
    return null;
  }
  if (intent.livemode || intent.metadata?.job_id !== jobId) return null;
  const methodId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id ?? null;
  const customerId = typeof intent.customer === "string" ? intent.customer : intent.customer?.id ?? null;
  if (!methodId || !customerId) return null;
  const saved = await supabase
    .from("customer_payment_methods")
    .select("stripe_customer_id, stripe_payment_method_id, brand, last4, detached_at")
    .eq("customer_id", userId)
    .eq("stripe_payment_method_id", methodId)
    .maybeSingle();
  const row = saved.data;
  if (
    !row ||
    !sameBookingCard({
      intentCustomerId: customerId,
      intentPaymentMethodId: methodId,
      savedCustomerId: row.stripe_customer_id,
      savedPaymentMethodId: row.stripe_payment_method_id,
      detached: row.detached_at != null,
    })
  ) {
    return null;
  }
  return { customerId, paymentMethodId: methodId, brand: row.brand, last4: row.last4 };
}

export async function rememberBookingCard(intent: Stripe.PaymentIntent): Promise<void> {
  if (intent.livemode || intent.metadata?.tip_id || intent.status !== "requires_capture") return;
  const jobId = intent.metadata?.job_id;
  const methodId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id ?? null;
  const stripeCustomerId = typeof intent.customer === "string" ? intent.customer : intent.customer?.id ?? null;
  if (!jobId || !methodId || !stripeCustomerId) return;
  const job = await createServiceClient().from("jobs").select("customer_id").eq("id", jobId).maybeSingle();
  if (!job.data?.customer_id) return;
  await rememberSavedCard({
    customerId: job.data.customer_id,
    stripeCustomerId,
    paymentMethodId: methodId,
  });
}

export async function rememberSavedCard(input: {
  customerId: string;
  stripeCustomerId: string | null;
  paymentMethodId: string | null;
}): Promise<void> {
  if (!input.stripeCustomerId || !input.paymentMethodId) return;
  const method = await getStripe().paymentMethods.retrieve(input.paymentMethodId);
  if (method.livemode) return;
  const card = method.card;
  await createServiceClient().rpc("save_payment_method", {
    target_customer: input.customerId,
    stripe_customer: input.stripeCustomerId,
    payment_method: method.id,
    card_brand: card?.brand ?? null,
    card_last4: card?.last4 ?? null,
  });
}
