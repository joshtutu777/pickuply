import "server-only";

import Stripe from "stripe";
import { paymentsMode, stripeEnvForMode } from "@/lib/payments/payments-mode";
import { stripeModeProblem } from "@/lib/stripe-mode";

let client: Stripe | null = null;
let cachedKey = "";

/** Stripe client for the current payments mode. A test process never receives the live secret. */
export function getStripe(): Stripe {
  const mode = paymentsMode(process.env.PAYMENTS_MODE);
  const selected = stripeEnvForMode(mode, process.env);
  const problem = stripeModeProblem(selected.secret, selected.publishable, mode);
  if (problem) throw new Error(problem);
  const key = selected.secret ?? "";
  if (!client || cachedKey !== key) {
    client = new Stripe(key);
    cachedKey = key;
  }
  return client;
}

export function stripeWebhookEvent(payload: string, signature: string, secret: string): Stripe.Event {
  if (!secret.startsWith("whsec_")) {
    throw new Error("The webhook signing secret is not configured.");
  }
  return getStripe().webhooks.constructEvent(payload, signature, secret);
}
