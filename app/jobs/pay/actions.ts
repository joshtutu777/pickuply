"use server";

import { connection } from "next/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkoutExpiresAt } from "@/lib/payments/checkout-expiry";
import { requestOrigin } from "@/lib/payments/connect";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const knownErrors = new Set([
  "sign in required",
  "only the customer can pay for this job",
  "this job is not waiting for payment",
  "payment is not due",
  "the payment window has closed",
  "the price breakdown does not add up",
  "payment is on hold",
]);

function checkoutError(message: string | undefined): string {
  const text = message ?? "";
  for (const known of knownErrors) {
    if (text.includes(known)) return known;
  }
  return "The card checkout could not be started.";
}

export async function startCheckout(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  const origin = requestOrigin(await headers());
  const supabase = await createClient();
  const prepared = await supabase.rpc("prepare_checkout", { target_job: jobId });
  if (prepared.error || !prepared.data) {
    redirect(`/jobs/${jobId}?error=${encodeURIComponent(checkoutError(prepared.error?.message))}`);
  }

  const row = prepared.data as {
    attempt: number;
    amount_cents: number;
    driver_id: string;
    due_at: string;
  };
  const expiresAt = checkoutExpiresAt(new Date(row.due_at).getTime(), new Date().getTime());
  let sessionId = "";
  let sessionUrl: string | null = null;
  let checkoutLive = false;
  try {
    const session = await getStripe().checkout.sessions.create(
      {
        mode: "payment",
        allowed_payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: row.amount_cents,
              product_data: { name: "Pickuply job" },
            },
          },
        ],
        payment_intent_data: {
          capture_method: "manual",
          metadata: { job_id: jobId, driver_id: row.driver_id },
        },
        metadata: { job_id: jobId, driver_id: row.driver_id, attempt: String(row.attempt) },
        expires_at: expiresAt,
        success_url: `${origin}/jobs/${jobId}?paid=return`,
        cancel_url: `${origin}/jobs/${jobId}?paid=cancel`,
      },
      { idempotencyKey: `checkout:${jobId}:${row.attempt}` },
    );
    sessionId = session.id;
    sessionUrl = session.url;
    checkoutLive = session.livemode;
  } catch {
    redirect(`/jobs/${jobId}?error=${encodeURIComponent("The card checkout could not be started.")}`);
  }

  const service = createServiceClient();
  const recorded = await service.rpc("record_checkout_session", {
    target_job: jobId,
    session_id: sessionId,
    attempt: row.attempt,
  });
  if (!recorded.error) {
    const marked = await service.rpc("note_stripe_livemode", { target_job: jobId, live: checkoutLive });
    if (marked.error) {
      try {
        await getStripe().checkout.sessions.expire(sessionId);
      } catch {
        // The attempt number will not be reused. The customer can start again.
      }
      redirect(`/jobs/${jobId}?error=${encodeURIComponent("The card checkout could not be started.")}`);
    }
  }
  if (recorded.error || !sessionUrl) {
    if (sessionId) {
      try {
        await getStripe().checkout.sessions.expire(sessionId);
      } catch {
        // The attempt number will not be reused. The customer can start again.
      }
    }
    redirect(`/jobs/${jobId}?error=${encodeURIComponent("The card checkout could not be started.")}`);
  }
  redirect(sessionUrl);
}
