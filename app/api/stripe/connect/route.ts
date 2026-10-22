import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { saveConnectAccount } from "@/lib/payments/connect";
import { claimStripeEvent, readStripeEvent, releaseStripeEvent } from "@/lib/payments/webhook";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: Request) {
  const event = await readStripeEvent(request, "STRIPE_CONNECT_WEBHOOK_SECRET");
  if (event instanceof NextResponse) return event;
  if (event.type !== "account.updated") return NextResponse.json({ ok: true, ignored: true });

  const claimed = await claimStripeEvent(event);
  if (claimed instanceof NextResponse) return claimed;
  if (claimed.duplicate) return NextResponse.json({ ok: true, duplicate: true });

  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const driverId = account.metadata?.driver_id;
    if (driverId) {
      try {
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
      } catch {
        await releaseStripeEvent(event.id);
        return NextResponse.json({ ok: false }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
