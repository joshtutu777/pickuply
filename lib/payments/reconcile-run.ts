import "server-only";

import type Stripe from "stripe";
import { alertPaymentsIssue } from "@/lib/payments/mode-alert";
import { acceptOrRelease } from "@/lib/payments/platform-events";
import { reconcilePaymentAction } from "@/lib/payments/reconcile";
import { getStripeForRecordedMode } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";

type OpenJob = {
  id: string;
  status: string;
  payment_status: string;
  payment_due_at: string | null;
  is_test: boolean;
};

/**
 * Catches a PaymentIntent the webhook did not apply.
 * Each intent is read with the test or live key saved on that payment.
 * It does not create or capture a charge. Running it again for the same intent does not add a second attempt.
 */
export async function reconcileOpenPayments(): Promise<{ checked: number; applied: number }> {
  const supabase = createServiceClient();
  const jobs = await supabase
    .from("jobs")
    .select("id, status, payment_status, payment_due_at, is_test")
    .in("payment_status", ["awaiting_payment", "failed", "authorized"])
    .in("status", ["assigned", "en_route", "arrived", "item_check", "in_transit", "delivered"])
    .limit(30);
  if (jobs.error) throw new Error("Open payments could not be listed.");
  const rows = (jobs.data ?? []) as OpenJob[];
  if (rows.length === 0) return { checked: 0, applied: 0 };

  const payments = await supabase
    .from("job_payments")
    .select("job_id, payment_intent_id, stripe_livemode")
    .in("job_id", rows.map((row) => row.id))
    .not("payment_intent_id", "is", null);
  if (payments.error) throw new Error("Stored payment intents could not be listed.");
  const paymentByJob = new Map(
    (payments.data ?? []).map((row) => [
      row.job_id as string,
      {
        paymentIntentId: row.payment_intent_id as string,
        recordedLivemode: typeof row.stripe_livemode === "boolean" ? row.stripe_livemode : null,
      },
    ]),
  );

  const eventsByMode = new Map<boolean, Map<string, string>>();
  let applied = 0;
  let failed = 0;
  const seen = new Set<string>();
  for (const job of rows) {
    const stored = paymentByJob.get(job.id);
    const intentId = stored?.paymentIntentId;
    if (!intentId || !stored || seen.has(intentId)) continue;
    seen.add(intentId);
    if (stored.recordedLivemode == null) {
      await alertPaymentsIssue(
        `reconcile-mode:${intentId}`,
        "Payment catch-up has no saved mode",
        "An open payment has no saved test or live mode. It was left unchanged.",
      );
      await recordReconcile(supabase, job, intentId, "unknown", "missing_mode");
      continue;
    }
    let intent: Stripe.PaymentIntent;
    try {
      intent = await getStripeForRecordedMode(stored.recordedLivemode).paymentIntents.retrieve(intentId);
    } catch {
      failed += 1;
      continue;
    }
    const fresh = await supabase
      .from("jobs")
      .select("id, status, payment_status, payment_due_at, is_test")
      .eq("id", job.id)
      .maybeSingle();
    if (fresh.error || !fresh.data) throw new Error("The booking could not be read before reconciliation.");
    const current = fresh.data as OpenJob;
    const now = new Date().toISOString();
    const action = reconcilePaymentAction({
      recordedLivemode: stored.recordedLivemode,
      livemode: intent.livemode,
      intentStatus: intent.status,
      jobStatus: current.status,
      paymentStatus: current.payment_status,
      paymentDueAt: current.payment_due_at,
      now,
    });
    if (action === "report_mismatch") {
      await alertPaymentsIssue(
        `reconcile-object:${intent.id}`,
        "Payment catch-up mode mismatch",
        "An open payment did not match its saved test or live mode. It was left unchanged.",
      );
      await recordReconcile(supabase, current, intent.id, intent.status, action);
      continue;
    }
    if (action === "skip") continue;
    if (action === "skip_closed") {
      await recordReconcile(supabase, current, intent.id, intent.status, action);
      continue;
    }
    const eventByIntent = await eventsForMode(eventsByMode, stored.recordedLivemode);
    const eventId = eventByIntent.get(intent.id) ?? null;
    let claimedNow = false;
    if (eventId) {
      const claimed = await supabase.rpc("claim_stripe_event", {
        event_id: eventId,
        event_type: action === "authorize" ? "payment_intent.amount_capturable_updated" : "payment_intent.canceled",
        account_id: null,
      });
      if (claimed.error) throw new Error("The payment event could not be stored.");
      claimedNow = claimed.data === true;
    }
    if (action === "authorize") {
      try {
        await acceptOrRelease(intent);
      } catch (error) {
        if (claimedNow && eventId) await supabase.from("stripe_events").delete().eq("id", eventId);
        throw error;
      }
      await recordReconcile(supabase, current, intent.id, intent.status, action);
      applied += 1;
      continue;
    }
    const prior = await supabase
      .from("payment_attempts")
      .select("job_id")
      .eq("payment_intent_id", intent.id)
      .eq("outcome", "canceled")
      .limit(1);
    if (prior.error) throw new Error("Earlier payment attempts could not be read.");
    if ((prior.data ?? []).length > 0) continue;
    const noted = await supabase.rpc("note_authorization_canceled", {
      target_job: current.id,
      payment_intent: intent.id,
    });
    if (noted.error) {
      if (claimedNow && eventId) await supabase.from("stripe_events").delete().eq("id", eventId);
      throw new Error("The canceled authorization could not be recorded.");
    }
    if (action === "record_unpaid_cancel" && !current.is_test) {
      const released = await supabase.rpc("release_overdue_job", { target_job: current.id });
      if (released.error) throw new Error("An unpaid job could not be released.");
    }
    await recordReconcile(supabase, current, intent.id, intent.status, action);
    applied += 1;
  }
  if (failed > 0) throw new Error("A stored payment could not be read from Stripe.");
  return { checked: seen.size, applied };
}

async function eventsForMode(
  cache: Map<boolean, Map<string, string>>,
  livemode: boolean,
): Promise<Map<string, string>> {
  const saved = cache.get(livemode);
  if (saved) return saved;
  try {
    const map = await eventIdsByIntent(getStripeForRecordedMode(livemode), [
      "payment_intent.amount_capturable_updated",
      "payment_intent.canceled",
    ]);
    cache.set(livemode, map);
    return map;
  } catch {
    const empty = new Map<string, string>();
    cache.set(livemode, empty);
    return empty;
  }
}

async function recordReconcile(
  supabase: ReturnType<typeof createServiceClient>,
  job: OpenJob,
  paymentIntentId: string,
  intentStatus: string,
  decision: string,
): Promise<void> {
  const existing = await supabase
    .from("audit_log")
    .select("id")
    .eq("action", "payment_reconciled")
    .eq("target_id", job.id)
    .contains("data", { payment_intent_id: paymentIntentId, decision })
    .limit(1);
  if (existing.error) throw new Error("The reconciliation record could not be read.");
  if ((existing.data ?? []).length > 0) return;
  const inserted = await supabase.from("audit_log").insert({
    actor_id: null,
    action: "payment_reconciled",
    target_type: "job",
    target_id: job.id,
    data: {
      payment_intent_id: paymentIntentId,
      decision,
      intent_status: intentStatus,
      job_status: job.status,
      payment_status: job.payment_status,
    },
  });
  if (inserted.error) throw new Error("The reconciliation record could not be saved.");
}

async function eventIdsByIntent(
  stripe: Stripe,
  types: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const type of types) {
    const page = await stripe.events.list({ type, limit: 20 });
    for (const event of page.data) {
      const object = event.data.object as { id?: string };
      if (object.id?.startsWith("pi_")) map.set(object.id, event.id);
    }
  }
  return map;
}
