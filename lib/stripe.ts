import "server-only";

import Stripe from "stripe";

let client: Stripe | null = null;

/** Test-mode Stripe client. Live keys are refused. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_")) {
    throw new Error("Stripe test mode is not configured.");
  }
  if (!client) client = new Stripe(key);
  return client;
}

export function stripeWebhookEvent(payload: string, signature: string, secret: string): Stripe.Event {
  if (!secret.startsWith("whsec_")) {
    throw new Error("The webhook signing secret is not configured.");
  }
  return getStripe().webhooks.constructEvent(payload, signature, secret);
}
