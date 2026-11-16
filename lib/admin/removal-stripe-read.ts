import "server-only";

import Stripe from "stripe";
import {
  isRemovalIntentId,
  logMarketplaceRemoval,
  removalStripeErrorCategory,
  removalStripeIdCount,
  removalStripeSecret,
  type RemovalLivemode,
  type RemovalStripeIds,
  type RemovalStripeObject,
} from "./removal-stripe";

export type RemovalStripeRead =
  | { ok: true; objects: RemovalStripeObject[]; verified: RemovalStripeIds }
  | { ok: false };

function intentIdOf(value: string | Stripe.PaymentIntent | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Read checkout sessions, PaymentIntents, and charges for the saved payment mode.
 * This client is retrieve-only. It must not create, capture, cancel, expire, or refund a payment.
 * A lookup that fails is not repeated with a different Stripe account.
 */
export async function readRemovalStripeObjects(
  ids: RemovalStripeIds,
  livemode: RemovalLivemode,
): Promise<RemovalStripeRead> {
  if (removalStripeIdCount(ids) === 0) {
    return { ok: true, objects: [], verified: { sessions: [], intents: [], charges: [] } };
  }
  const selected = removalStripeSecret(livemode, ids, process.env);
  if (!selected.ok) {
    logMarketplaceRemoval({
      stage: "removal_stripe_key",
      code: selected.code,
      stripeError: null,
      key: selected.name,
    });
    return { ok: false };
  }
  const stripe = new Stripe(selected.secret);
  try {
    const objects: RemovalStripeObject[] = [];
    const sessions: string[] = [];
    const intents = new Set(ids.intents);
    const charges = new Set(ids.charges);

    for (const id of ids.sessions) {
      const session = await stripe.checkout.sessions.retrieve(id);
      const discovered = intentIdOf(session.payment_intent);
      if (discovered) {
        if (!isRemovalIntentId(discovered)) {
          logMarketplaceRemoval({
            stage: "removal_stripe_retrieve",
            code: "stripe_unverified",
            stripeError: "unexpected_id",
            key: selected.name,
          });
          return { ok: false };
        }
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
  } catch (error) {
    logMarketplaceRemoval({
      stage: "removal_stripe_retrieve",
      code: "stripe_unverified",
      stripeError: removalStripeErrorCategory(error),
      key: selected.name,
    });
    return { ok: false };
  }
}
