import { connection } from "next/server";
import { NextResponse } from "next/server";
import { stripeWebhookEvent } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";

export async function receiveStripeEvent(request: Request, secretName: "STRIPE_WEBHOOK_SECRET" | "STRIPE_CONNECT_WEBHOOK_SECRET") {
  await connection();
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  const secret = process.env[secretName] ?? "";
  let event;
  try {
    event = stripeWebhookEvent(payload, signature, secret);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const supabase = createServiceClient();
  const claimed = await supabase.rpc("claim_stripe_event", {
    event_id: event.id,
    event_type: event.type,
    account_id: typeof event.account === "string" ? event.account : null,
  });
  if (claimed.error) return NextResponse.json({ ok: false }, { status: 500 });
  if (!claimed.data) return NextResponse.json({ ok: true, duplicate: true });
  return { event, supabase };
}
