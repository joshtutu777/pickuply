import { connection } from "next/server";
import { NextResponse } from "next/server";
import { runCron } from "@/lib/cron/record";
import { deliverPendingAlerts } from "@/lib/notifications/deliver";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return runCron("notifications", async () => {
    const supabase = createServiceClient();
    const pickupReviews = await supabase.rpc("close_expired_pickup_reviews");
    if (pickupReviews.error) throw new Error("Expired pickup reviews could not be closed.");
    const { error } = await supabase.rpc("scan_notification_reminders");
    if (error) throw new Error("Notification reminders could not be scanned.");
    const expired = await supabase.rpc("expire_due_suspensions");
    if (expired.error) throw new Error("Expired suspensions could not be cleared.");
    const reviews = await supabase.rpc("note_review_windows");
    if (reviews.error) throw new Error("Review windows could not be checked.");
    const deletions = await supabase.rpc("process_due_deletions");
    if (deletions.error) throw new Error("Due account deletions could not be processed.");
    const retention = await supabase.rpc("cleanup_account_retention");
    if (retention.error) throw new Error("Account retention cleanup could not finish.");
    const announcements = await supabase.rpc("execute_due_announcements");
    if (announcements.error) throw new Error("Scheduled announcements could not be sent.");
    const campaigns = await supabase.rpc("execute_due_sms_campaigns");
    if (campaigns.error) throw new Error("Scheduled text campaigns could not be recorded.");
    await deliverPendingAlerts();
    return { ok: true };
  });
}
