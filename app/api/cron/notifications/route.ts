import { connection } from "next/server";
import { NextResponse } from "next/server";
import { deliverPendingAlerts } from "@/lib/notifications/deliver";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const { error } = await supabase.rpc("scan_notification_reminders");
    if (error) return NextResponse.json({ ok: false }, { status: 500 });
    const expired = await supabase.rpc("expire_due_suspensions");
    if (expired.error) return NextResponse.json({ ok: false }, { status: 500 });
    const reviews = await supabase.rpc("note_review_windows");
    if (reviews.error) return NextResponse.json({ ok: false }, { status: 500 });
    await deliverPendingAlerts();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
