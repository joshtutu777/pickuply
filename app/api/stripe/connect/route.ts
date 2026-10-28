import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { recordPayoutEvent, recordTransferEvent } from "@/lib/payments/connect-events";
import { saveConnectAccount } from "@/lib/payments/connect";
import { connectWebhookEvents, isListedEvent } from "@/lib/payments/event-types";
import { claimStripeEvent, readStripeEvent, releaseStripeEvent } from "@/lib/payments/webhook";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: Request) {
  const event = await readStripeEvent(request, "STRIPE_CONNECT_WEBHOOK_SECRET");
  if (event instanceof NextResponse) return event;
  if (!isListedEvent(event.type, connectWebhookEvents)) return NextResponse.json({ ok: true, ignored: true });

  const claimed = await claimStripeEvent(event);
  if (claimed instanceof NextResponse) return claimed;
  if (claimed.duplicate) return NextResponse.json({ ok: true, duplicate: true });

  try {
    if (event.type === "account.updated") {
      await handleAccount(event.data.object as Stripe.Account);
    } else if (event.type.startsWith("transfer.")) {
      await recordTransferEvent(event);
    } else if (event.type === "payout.paid" || event.type === "payout.failed") {
      await recordPayoutEvent(event);
    }
  } catch {
    await releaseStripeEvent(event.id);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function handleAccount(account: Stripe.Account) {
  const driverId = account.metadata?.driver_id;
  if (!driverId) return;
  await saveConnectAccount(driverId, account);
  const supabase = createServiceClient();
  if (account.payouts_enabled) {
    await supabase.rpc("enqueue_notification", {
      recipient: driverId,
      target_job: null,
      kind: "connect_ready",
      title: "Payouts are ready",
      body: "Stripe can send your earnings to your bank.",
      href: "/driver/earnings",
      dedupe_key: `connect-ready:${account.id}`,
    });
  } else if ((account.requirements?.currently_due ?? []).length > 0) {
    await supabase.rpc("enqueue_notification", {
      recipient: driverId,
      target_job: null,
      kind: "connect_needed",
      title: "Finish payout setup",
      body: "Stripe still needs a few details before you can be paid.",
      href: "/driver/earnings",
      dedupe_key: `connect-needed:${account.id}`,
    });
  }
}
