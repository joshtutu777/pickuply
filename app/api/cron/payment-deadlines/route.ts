import { connection } from "next/server";
import { NextResponse } from "next/server";
import { deliverPendingAlerts } from "@/lib/notifications/deliver";
import { getStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";

// Local check, from the project folder, with the cron secret from the environment:
// curl -H "Authorization: Bearer <CRON_SECRET>" http://127.0.0.1:3000/api/cron/payment-deadlines

const leaveOpen = new Set(["requires_capture", "processing", "succeeded"]);

export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const stripe = getStripe();
    const supabase = createServiceClient();
    const due = await supabase.rpc("overdue_payment_jobs");
    if (due.error) return NextResponse.json({ ok: false }, { status: 500 });

    for (const row of (due.data ?? []) as {
      job_id: string;
      payment_intent_id: string | null;
      checkout_session_id: string | null;
    }[]) {
      if (row.payment_intent_id) {
        try {
          const intent = await stripe.paymentIntents.retrieve(row.payment_intent_id);
          if (leaveOpen.has(intent.status)) continue;
          if (intent.status !== "canceled") {
            await stripe.paymentIntents.cancel(
              row.payment_intent_id,
              {},
              { idempotencyKey: `cancel-deadline:${row.payment_intent_id}` },
            );
          }
        } catch {
          if (row.checkout_session_id) {
            await stripe.checkout.sessions.expire(row.checkout_session_id).catch(() => undefined);
          }
        }
      }
      const released = await supabase.rpc("release_overdue_job", { target_job: row.job_id });
      if (released.error) return NextResponse.json({ ok: false }, { status: 500 });
    }

    const flagged = await supabase.rpc("flag_capture_windows");
    if (flagged.error) return NextResponse.json({ ok: false }, { status: 500 });
    await deliverPendingAlerts();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
