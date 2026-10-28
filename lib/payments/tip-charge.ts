import "server-only";

import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";

export function tipIdempotencyKey(tipId: string): string {
  return `tip:${tipId}`;
}

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
  const expanded = intent.latest_charge
    ? intent
    : await getStripe().paymentIntents.retrieve(intent.id, { expand: ["latest_charge.balance_transaction"] });
  const charge = expanded.latest_charge;
  const chargeId = typeof charge === "string" ? charge : charge?.id ?? null;
  const confirmed = await createServiceClient().rpc("confirm_tip_payment", {
    target_tip: tipId,
    payment_intent: expanded.id,
    charge_id: chargeId,
    fee_cents: await stripeFeeCents(expanded),
    live: false,
  });
  if (confirmed.error) throw new Error(confirmed.error.message);
}

export async function chargeSavedTip(input: {
  tipId: string;
  amountCents: number;
  customerId: string;
  paymentMethodId: string;
  jobId: string;
  driverId: string;
}): Promise<"paid" | "authenticate"> {
  const stripe = getStripe();
  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: "usd",
        customer: input.customerId,
        payment_method: input.paymentMethodId,
        off_session: true,
        confirm: true,
        metadata: { tip_id: input.tipId, job_id: input.jobId, driver_id: input.driverId },
        expand: ["latest_charge.balance_transaction"],
      },
      { idempotencyKey: tipIdempotencyKey(input.tipId) },
    );
    await createServiceClient().rpc("note_tip_intent", {
      target_tip: input.tipId,
      payment_intent: intent.id,
      next_status: "pending",
    });
    if (intent.status === "succeeded") {
      await confirmTipFromIntent(intent);
      return "paid";
    }
    await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `tip-cancel:${intent.id}` }).catch(() => undefined);
    return "authenticate";
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const paymentIntent = error && typeof error === "object" && "payment_intent" in error
      ? (error.payment_intent as Stripe.PaymentIntent | undefined)
      : undefined;
    if (paymentIntent?.id) {
      await createServiceClient().rpc("note_tip_intent", {
        target_tip: input.tipId,
        payment_intent: paymentIntent.id,
        next_status: "requires_action",
      });
      if (code === "authentication_required") {
        await stripe.paymentIntents.cancel(paymentIntent.id, {}, { idempotencyKey: `tip-cancel:${paymentIntent.id}` }).catch(() => undefined);
        return "authenticate";
      }
    }
    throw error;
  }
}

export async function rememberSavedCard(input: {
  customerId: string;
  stripeCustomerId: string | null;
  paymentMethodId: string | null;
}): Promise<void> {
  if (!input.stripeCustomerId || !input.paymentMethodId) return;
  const method = await getStripe().paymentMethods.retrieve(input.paymentMethodId);
  const card = method.card;
  await createServiceClient().rpc("save_payment_method", {
    target_customer: input.customerId,
    stripe_customer: input.stripeCustomerId,
    payment_method: method.id,
    card_brand: card?.brand ?? null,
    card_last4: card?.last4 ?? null,
  });
}
