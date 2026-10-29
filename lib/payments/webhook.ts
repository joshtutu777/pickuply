import { connection } from "next/server";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { paymentsMode, webhookSecretName } from "@/lib/payments/payments-mode";
import { stripeWebhookEvent } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";

type ServiceClient = ReturnType<typeof createServiceClient>;

export async function readStripeEvent(
  request: Request,
  kind: "payments" | "connect",
): Promise<Stripe.Event | NextResponse> {
  await connection();
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  const secret = process.env[webhookSecretName(kind, paymentsMode(process.env.PAYMENTS_MODE))] ?? "";
  try {
    return stripeWebhookEvent(payload, signature, secret);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}

export async function claimStripeEvent(
  event: Stripe.Event,
): Promise<{ supabase: ServiceClient; duplicate: boolean } | NextResponse> {
  const supabase = createServiceClient();
  const claimed = await supabase.rpc("claim_stripe_event", {
    event_id: event.id,
    event_type: event.type,
    account_id: typeof event.account === "string" ? event.account : null,
  });
  if (claimed.error) return NextResponse.json({ ok: false }, { status: 500 });
  return { supabase, duplicate: claimed.data !== true };
}

export async function releaseStripeEvent(eventId: string): Promise<void> {
  await createServiceClient().from("stripe_events").delete().eq("id", eventId);
}
