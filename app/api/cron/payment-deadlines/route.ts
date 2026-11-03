import { connection } from "next/server";
import { NextResponse } from "next/server";
import { runCron } from "@/lib/cron/record";
import { deliverPendingAlerts } from "@/lib/notifications/deliver";
import { alertPaymentsIssue } from "@/lib/payments/mode-alert";
import { settleOverduePayments } from "@/lib/payments/deadline";
import { reconcileOpenPayments } from "@/lib/payments/reconcile-run";
import { getStripeForRecordedMode } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";

// Local check, from the project folder, with the cron secret from the environment:
// curl -H "Authorization: Bearer <CRON_SECRET>" http://127.0.0.1:3000/api/cron/payment-deadlines

export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return runCron("payment-deadlines", async () => {
    const supabase = createServiceClient();
    const due = await supabase.rpc("overdue_payment_jobs");
    if (due.error) throw new Error("Payment deadlines could not be listed.");
    const dueRows = (due.data ?? []) as {
      job_id: string;
      payment_intent_id: string | null;
      checkout_session_id: string | null;
    }[];
    const storedModes = new Map<string, boolean | null>();
    if (dueRows.length > 0) {
      const stored = await supabase
        .from("job_payments")
        .select("job_id, stripe_livemode")
        .in("job_id", dueRows.map((row) => row.job_id));
      if (stored.error) throw new Error("Stored payment modes could not be listed.");
      for (const row of stored.data ?? []) {
        storedModes.set(row.job_id, typeof row.stripe_livemode === "boolean" ? row.stripe_livemode : null);
      }
    }

    const outcomes = await settleOverduePayments(
      dueRows.map((row) => ({
        jobId: row.job_id,
        paymentIntentId: row.payment_intent_id,
        recordedLivemode: row.payment_intent_id ? storedModes.get(row.job_id) ?? null : null,
      })),
      (livemode) => {
        const stripe = getStripeForRecordedMode(livemode);
        return {
          async retrievePaymentIntent(id: string) {
            const intent = await stripe.paymentIntents.retrieve(id);
            return { status: intent.status, livemode: intent.livemode };
          },
          async cancelPaymentIntent(id: string) {
            await stripe.paymentIntents.cancel(id, {}, { idempotencyKey: `cancel-deadline:${id}` });
          },
        };
      },
      async (jobId) => {
        const released = await supabase.rpc("release_overdue_job", { target_job: jobId });
        if (released.error) throw new Error("An overdue job could not be released.");
        return released.data === true;
      },
    );
    for (const [index, outcome] of outcomes.entries()) {
      const row = dueRows[index];
      if (!row) continue;
      if (outcome === "missing_mode" || outcome === "mode_mismatch") {
        await alertPaymentsIssue(
          `deadline-mode:${row.job_id}`,
          "Payment deadline left unchanged",
          "An unpaid booking did not have a matching saved test or live mode. The driver was left assigned.",
        );
      }
    }

    const flagged = await supabase.rpc("flag_capture_windows");
    if (flagged.error) throw new Error("Capture windows could not be checked.");
    await reconcileOpenPayments();
    await deliverPendingAlerts();
    if (outcomes.some((outcome) => outcome === "stripe_failed")) {
      throw new Error("A stored payment could not be read from Stripe.");
    }
    return { ok: true };
  });
}
