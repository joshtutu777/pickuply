import "server-only";

import type Stripe from "stripe";
import { sendEmail } from "@/lib/email";
import { buildReceiptText } from "@/lib/payments/receipt";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type CaptureContext = {
  payment_intent_id: string;
  charge_id: string | null;
  amount_cents: number;
  kind: "full" | "trip" | "late_cancel";
  capture_before: string | null;
  service_fee_cents: number | null;
  expired: boolean;
};

async function stripeFeeCents(chargeId: string | null): Promise<{ fee: number | null; availableOn: string | null }> {
  if (!chargeId) return { fee: null, availableOn: null };
  const charge = await getStripe().charges.retrieve(chargeId, { expand: ["balance_transaction"] });
  const balance = charge.balance_transaction;
  if (!balance || typeof balance === "string") return { fee: null, availableOn: null };
  return {
    fee: balance.fee,
    availableOn: balance.available_on ? new Date(balance.available_on * 1000).toISOString() : null,
  };
}

async function chargeIdFromIntent(intent: Stripe.PaymentIntent): Promise<string | null> {
  const latest = intent.latest_charge;
  return typeof latest === "string" ? latest : latest?.id ?? null;
}

export async function captureReadyPayment(jobId: string): Promise<void> {
  const supabase = createServiceClient();
  const context = await supabase.rpc("capture_context", { target_job: jobId });
  if (context.error) throw new Error("The payment could not be checked.");
  const row = context.data as CaptureContext | null;
  if (!row) return;
  if (row.expired) {
    await supabase.rpc("note_capture_expired", { target_job: jobId });
    return;
  }

  const stripe = getStripe();
  const existing = await stripe.paymentIntents.retrieve(row.payment_intent_id);
  const intent =
    existing.status === "requires_capture"
      ? await stripe.paymentIntents.capture(
          row.payment_intent_id,
          row.kind === "trip" || row.kind === "late_cancel" ? { amount_to_capture: row.amount_cents } : {},
          { idempotencyKey: `capture:${row.payment_intent_id}:${row.kind}` },
        )
      : existing;
  if (intent.status !== "succeeded") return;

  const chargeId = (await chargeIdFromIntent(intent)) ?? row.charge_id;
  const balance = await stripeFeeCents(chargeId);
  const recorded = await supabase.rpc("record_capture", {
    target_job: jobId,
    amount_cents: row.amount_cents,
    kind: row.kind,
    stripe_fee: balance.fee,
  });
  if (recorded.error) throw new Error("The capture could not be recorded.");
  await supabase.rpc("post_driver_earnings", {
    target_job: jobId,
    available_on: balance.availableOn,
  });
  await sendReceipt(jobId);
}

export async function syncStripeFees(): Promise<void> {
  const supabase = createServiceClient();
  const missing = await supabase.rpc("payments_missing_stripe_fee");
  if (missing.error) return;
  for (const row of (missing.data ?? []) as { job_id: string; charge_id: string }[]) {
    const fee = await stripeFeeCents(row.charge_id);
    if (fee.fee == null) continue;
    await supabase.rpc("record_stripe_fee", { target_job: row.job_id, stripe_fee: fee.fee });
    if (fee.availableOn) {
      await supabase.rpc("post_driver_earnings", { target_job: row.job_id, available_on: fee.availableOn });
    }
  }
}

export async function releaseCustomerAuthorization(jobId: string): Promise<"free" | "released" | "late_cancel"> {
  const supabase = createServiceClient();
  const user = await createClient();
  const started = await user.rpc("begin_customer_cancel", { target_job: jobId });
  if (started.error || !started.data) {
    throw new Error(started.error?.message ?? "This job could not be cancelled.");
  }
  const row = started.data as {
    outcome: "free" | "release" | "late_cancel";
    payment_intent_id: string | null;
    checkout_session_id?: string | null;
  };
  if (row.outcome === "late_cancel") {
    await captureReadyPayment(jobId);
    return "late_cancel";
  }
  if (row.outcome === "free") {
    if (row.checkout_session_id || row.payment_intent_id) {
      try {
        const stripe = getStripe();
        if (row.checkout_session_id) await stripe.checkout.sessions.expire(row.checkout_session_id);
        if (row.payment_intent_id) {
          const intent = await stripe.paymentIntents.retrieve(row.payment_intent_id);
          if (intent.status !== "canceled" && intent.status !== "succeeded") {
            await stripe.paymentIntents.cancel(
              row.payment_intent_id,
              {},
              { idempotencyKey: `cancel:${row.payment_intent_id}` },
            );
          }
        }
      } catch {
        // The job is already cancelled. A later card approval is released by the payment webhook.
      }
    }
    return "free";
  }

  if (!row.payment_intent_id) throw new Error("The card hold could not be found.");
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.retrieve(row.payment_intent_id);
  if (intent.status !== "canceled") {
    await stripe.paymentIntents.cancel(row.payment_intent_id, {}, { idempotencyKey: `cancel:${row.payment_intent_id}` });
  }
  const finished = await supabase.rpc("finish_released_cancel", { target_job: jobId });
  if (finished.error) throw new Error("The card hold was released, but the job could not be cancelled.");
  return "released";
}

/** Release a card hold after a cancellation that did not record a late-cancel or trip fee. */
export async function releaseUnchargedCancel(jobId: string): Promise<void> {
  const supabase = createServiceClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("status, payment_status, trip_fee_cents, late_cancel_cents")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.status !== "cancelled" || job.payment_status !== "authorized") return;
  if ((job.trip_fee_cents ?? 0) > 0 || (job.late_cancel_cents ?? 0) > 0) return;
  const { data: payment } = await supabase
    .from("job_payments")
    .select("payment_intent_id")
    .eq("job_id", jobId)
    .maybeSingle();
  const stripe = getStripe();
  const intentIds = new Set<string>();
  if (payment?.payment_intent_id) intentIds.add(payment.payment_intent_id);
  if (intentIds.size === 0 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    const searched = await stripe.paymentIntents.search({
      query: `metadata['job_id']:'${jobId}'`,
      limit: 10,
    });
    for (const found of searched.data) {
      if (found.metadata?.job_id === jobId && found.status === "requires_capture") intentIds.add(found.id);
    }
  }
  for (const intentId of intentIds) {
    const intent = await stripe.paymentIntents.retrieve(intentId);
    if (intent.status !== "canceled" && intent.status !== "succeeded") {
      await stripe.paymentIntents.cancel(intentId, {}, { idempotencyKey: `cancel:${intentId}` });
    }
  }
  const finished = await supabase.rpc("finish_released_cancel", { target_job: jobId });
  if (finished.error) throw new Error("The card hold was released, but the job could not be cancelled.");
}

async function sendReceipt(jobId: string): Promise<void> {
  const supabase = createServiceClient();
  const [{ data: job }, { data: payment }, { data: privateRow }] = await Promise.all([
    supabase
      .from("jobs")
      .select("service, customer_id, assigned_driver_id, driver_pay_cents, platform_fee_cents, service_fee_cents, price_cents, trip_fee_cents, captured_cents, refunded_cents, payment_status, updated_at")
      .eq("id", jobId)
      .maybeSingle(),
    supabase.from("job_payments").select("captured_at").eq("job_id", jobId).maybeSingle(),
    supabase.from("job_private").select("customer_email").eq("job_id", jobId).maybeSingle(),
  ]);
  if (!job) return;
  let driverName: string | null = null;
  if (job.assigned_driver_id) {
    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", job.assigned_driver_id).maybeSingle();
    driverName = profile?.full_name?.split(" ")[0] ?? null;
  }
  const when = payment?.captured_at ?? job.updated_at;
  const text = buildReceiptText({
    jobId,
    service: job.service,
    when: new Date(when).toISOString().slice(0, 10),
    driverFirstName: driverName,
    driverSubtotalCents:
      job.driver_pay_cents == null ? null : job.driver_pay_cents + (job.platform_fee_cents ?? 0),
    serviceFeeCents: job.service_fee_cents,
    totalCents: job.price_cents,
    tripFeeCents: job.trip_fee_cents,
    capturedCents: job.captured_cents,
    refundedCents: job.refunded_cents ?? 0,
    paymentStatus: job.payment_status,
  });
  if (privateRow?.customer_email) {
    await sendEmail(privateRow.customer_email, "Your Pickuply receipt", text);
  }
}
