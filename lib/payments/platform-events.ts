import "server-only";

import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";

const handled = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "payment_intent.amount_capturable_updated",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
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
  if (result.error) throw new Error("The authorization could not be recorded.");
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
  }
}
