import { connection } from "next/server";
import { NextResponse } from "next/server";
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

  try {
    const supabase = createServiceClient();
    const ready = await supabase.rpc("jobs_ready_for_capture");
    if (ready.error) return NextResponse.json({ ok: false }, { status: 500 });
    for (const row of (ready.data ?? []) as { job_id: string }[]) {
      await captureReadyPayment(row.job_id);
    }
    await syncStripeFees();
    await deliverPendingAlerts();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
