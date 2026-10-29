import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { recordPayoutEvent, recordTransferEvent } from "@/lib/payments/connect-events";
import { saveConnectAccount } from "@/lib/payments/connect";
import { requestDriverTransfers } from "@/lib/payments/connect-capability";
import { sendReadyTransfers } from "@/lib/payments/transfers";
import { accountMatch, connectWebhookAction, unknownDriverNote } from "@/lib/payments/connect-plan";
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
    const action = connectWebhookAction(event.type);
    if (action === "account") {
      await handleAccount(event.data.object as Stripe.Account, event.id);
    } else if (action === "transfer") {
      await recordTransferEvent(event);
    } else if (action === "payout") {
      await recordPayoutEvent(event);
    }
  } catch {
    await releaseStripeEvent(event.id);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function handleAccount(account: Stripe.Account, eventId: string) {
  const driverId = account.metadata?.driver_id ?? null;
  const supabase = createServiceClient();
  let driverExists = false;
  if (driverId) {
    const driver = await supabase.from("drivers").select("profile_id").eq("profile_id", driverId).maybeSingle();
    if (driver.error) throw new Error("The driver could not be read.");
    driverExists = Boolean(driver.data);
  }
  if (accountMatch({ driverId, driverExists }) === "ignore") {
    try {
      await noteUnknownAccount(account.id, eventId, driverId);
    } catch {
      // The Stripe event is already stored. A note failure must not turn this into a 500.
    }
    return;
  }
  try {
    await requestDriverTransfers(account.id);
  } catch {
    // The status read below still records whatever Stripe has now.
  }
  const saved = await saveConnectAccount(driverId as string, account);
  if (saved.payoutsEnabled && saved.transfersActive) {
    await supabase.rpc("enqueue_notification", {
      recipient: driverId,
      target_job: null,
      kind: "connect_ready",
      title: "Payouts are ready",
      body: "Stripe can send your earnings to your Stripe account. They usually reach your bank about 2 business days after the job.",
      href: "/driver/earnings",
      dedupe_key: `connect-ready:${account.id}`,
    });
    try {
      await sendReadyTransfers({ driverId: driverId as string });
    } catch {
      // The 15-minute transfer job retries a row that is ready and not held.
    }
  } else if ((account.requirements?.currently_due ?? []).length > 0 || saved.payoutsEnabled) {
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

/** The event stays stored. Admins get an in-app alert only, so this does not send a text. */
async function noteUnknownAccount(accountId: string, eventId: string, driverId: string | null): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  await supabase.from("audit_log").insert({
    actor_id: null,
    action: "connect_account_ignored",
    target_type: "stripe_account",
    target_id: null,
    data: { account_id: accountId, event_id: eventId, driver_id: driverId, note: unknownDriverNote },
  });
  const admins = await supabase.from("profiles").select("id").eq("role", "admin");
  for (const admin of admins.data ?? []) {
    await supabase.from("notifications").insert({
      profile_id: admin.id,
      job_id: null,
      kind: "connect_unknown",
      title: "Unknown payout account",
      body: `A Stripe account update was stored and marked ${unknownDriverNote}.`,
      href: "/admin/health",
      dedupe_key: `connect-unknown:${accountId}`,
      push_sent_at: now,
      email_sent_at: now,
      sms_sent_at: now,
    });
  }
}
