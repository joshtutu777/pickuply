import { connection } from "next/server";
import { NextResponse } from "next/server";
import { runCron } from "@/lib/cron/record";
import { captureReadyPayment, syncStripeFees } from "@/lib/payments/capture";
import { deliverPendingAlerts } from "@/lib/notifications/deliver";
import { createServiceClient } from "@/lib/supabase/service";

// Local check: curl -H "Authorization: Bearer <CRON_SECRET>" http://127.0.0.1:3000/api/cron/auto-complete

export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return runCron("auto-complete", async () => {
    const supabase = createServiceClient();
    const ready = await supabase.rpc("jobs_ready_for_capture");
    if (ready.error) throw new Error("Delivered jobs could not be listed.");
    for (const row of (ready.data ?? []) as { job_id: string }[]) {
      await captureReadyPayment(row.job_id);
    }
    await syncStripeFees();
    await deliverPendingAlerts();
    return { ok: true };
  });
}
