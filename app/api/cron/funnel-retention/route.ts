import { connection } from "next/server";
import { NextResponse } from "next/server";
import { runCron } from "@/lib/cron/record";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return runCron("funnel-retention", async () => {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("delete_expired_funnel_events");
    if (error) throw new Error("Funnel cleanup could not finish.");
    return { ok: true, removed: data ?? 0 };
  });
}
