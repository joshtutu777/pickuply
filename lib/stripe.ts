import "server-only";

import Stripe from "stripe";
import { stripeModeProblem } from "@/lib/stripe-mode";

let client: Stripe | null = null;

/** Test-mode Stripe client. Live keys and mixed test/live keys are refused. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  const problem = stripeModeProblem(key, process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  if (problem) throw new Error(problem);
  if (!client) client = new Stripe(key);
  return client;
}

export function stripeWebhookEvent(payload: string, signature: string, secret: string): Stripe.Event {
  if (!secret.startsWith("whsec_")) {
    throw new Error("The webhook signing secret is not configured.");
  }
  return getStripe().webhooks.constructEvent(payload, signature, secret);
}
