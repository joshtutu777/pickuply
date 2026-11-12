import "server-only";

import Stripe from "stripe";
import { paymentsMode, recordedPaymentSecret, stripeEnvForMode } from "@/lib/payments/payments-mode";
import { stripeModeProblem } from "@/lib/stripe-mode";

const clients = new Map<string, Stripe>();

function clientForKey(key: string): Stripe {
  const existing = clients.get(key);
  if (existing) return existing;
  const created = new Stripe(key);
  clients.set(key, created);
  return created;
}

/** Stripe client for the current payments mode. A test process never receives the live secret. */
export function getStripe(): Stripe {
  const mode = paymentsMode(process.env.PAYMENTS_MODE);
  const selected = stripeEnvForMode(mode, process.env);
  const problem = stripeModeProblem(selected.secret, selected.publishable, mode);
  if (problem) throw new Error(problem);
  return clientForKey(selected.secret ?? "");
}

/** Stripe client for a payment row's saved mode. This does not read PAYMENTS_MODE. */
export function getStripeForRecordedMode(livemode: boolean): Stripe {
  return clientForKey(recordedPaymentSecret(livemode, process.env).value);
}

export function stripeWebhookEvent(payload: string, signature: string, secret: string): Stripe.Event {
  return constructStripeEvent(payload, signature, secret);
}

/** Verify a webhook without reading PAYMENTS_MODE. The signature picks the secret. */
export function constructStripeEvent(payload: string, signature: string, secret: string): Stripe.Event {
  if (!secret.startsWith("whsec_")) {
    throw new Error("The webhook signing secret is not configured.");
  }
  return Stripe.webhooks.constructEvent(payload, signature, secret);
}
