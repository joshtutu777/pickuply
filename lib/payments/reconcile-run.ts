import "server-only";

import { acceptOrRelease } from "@/lib/payments/platform-events";
import { reconcilePaymentAction } from "@/lib/payments/reconcile";
import { getStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";

type OpenJob = {
  id: string;
  status: string;
  payment_status: string;
  payment_due_at: string | null;
  is_test: boolean;
};

/**
 * Catches a test-mode PaymentIntent the webhook did not apply.
 * It retrieves the intent and calls the same database functions as the webhook.
 * It does not create or capture a charge. Running it again for the same intent does not add a second attempt.
 */
export async function reconcileOpenPayments(): Promise<{ checked: number; applied: number }> {
  const stripe = getStripe();
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
    .select("job_id, payment_intent_id")
    .in("job_id", rows.map((row) => row.id))
    .not("payment_intent_id", "is", null);
  if (payments.error) throw new Error("Stored payment intents could not be listed.");
  const intentByJob = new Map(
    (payments.data ?? []).map((row) => [row.job_id as string, row.payment_intent_id as string]),
  );

  const eventByIntent = await eventIdsByIntent(stripe, [
    "payment_intent.amount_capturable_updated",
    "payment_intent.canceled",
  ]);
  let applied = 0;
  const seen = new Set<string>();
  for (const job of rows) {
    const intentId = intentByJob.get(job.id);
    if (!intentId || seen.has(intentId)) continue;
    seen.add(intentId);
    const intent = await stripe.paymentIntents.retrieve(intentId);
    const fresh = await supabase
      .from("jobs")
      .select("id, status, payment_status, payment_due_at, is_test")
      .eq("id", job.id)
      .maybeSingle();
    if (fresh.error || !fresh.data) throw new Error("The booking could not be read before reconciliation.");
    const current = fresh.data as OpenJob;
    const now = new Date().toISOString();
    const action = reconcilePaymentAction({
      livemode: intent.livemode,
      intentStatus: intent.status,
      jobStatus: current.status,
      paymentStatus: current.payment_status,
      paymentDueAt: current.payment_due_at,
      now,
    });
    if (action === "skip") continue;
    if (action === "skip_closed") {
      await recordReconcile(supabase, current, intent.id, intent.status, action);
      continue;
    }
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
  return { checked: seen.size, applied };
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
  stripe: ReturnType<typeof getStripe>,
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
