import "server-only";

import Stripe from "stripe";
import { isRemovalIntentId, type RemovalStripeIds, type RemovalStripeObject } from "./removal-stripe";

export type RemovalStripeRead =
  | { ok: true; objects: RemovalStripeObject[]; verified: RemovalStripeIds }
  | { ok: false };

function removalStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_") && !key.startsWith("sk_live_")) {
    throw new Error("Stripe is not configured.");
  }
  return new Stripe(key);
}

function intentIdOf(value: string | Stripe.PaymentIntent | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Read checkout sessions, PaymentIntents, and charges.
 * This client is retrieve-only. It must not create, capture, cancel, or refund a payment.
 */
export async function readRemovalStripeObjects(ids: RemovalStripeIds): Promise<RemovalStripeRead> {
  try {
    const stripe = removalStripe();
    const objects: RemovalStripeObject[] = [];
    const sessions: string[] = [];
    const intents = new Set(ids.intents);
    const charges = new Set(ids.charges);

    for (const id of ids.sessions) {
      const session = await stripe.checkout.sessions.retrieve(id);
      const discovered = intentIdOf(session.payment_intent);
      if (discovered) {
        if (!isRemovalIntentId(discovered)) return { ok: false };
        intents.add(discovered);
      }
      objects.push({
        kind: "session",
        status: session.status,
        paymentStatus: session.payment_status,
      });
      sessions.push(id);
    }

    for (const id of intents) {
      const intent = await stripe.paymentIntents.retrieve(id);
      objects.push({
        kind: "intent",
        status: intent.status,
        amountReceived: intent.amount_received,
        amountCapturable: intent.amount_capturable,
      });
    }

    for (const id of charges) {
      const charge = await stripe.charges.retrieve(id);
      objects.push({
        kind: "charge",
        status: charge.status,
        paid: charge.paid,
        refunded: charge.refunded,
        amountRefunded: charge.amount_refunded,
        disputed: charge.disputed,
      });
    }

    return {
      ok: true,
      objects,
      verified: { sessions, intents: [...intents], charges: [...charges] },
    };
  } catch {
    return { ok: false };
  }
}
