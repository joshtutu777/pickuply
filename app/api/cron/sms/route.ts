import { connection } from "next/server";
import { NextResponse } from "next/server";
import { runCron } from "@/lib/cron/record";
import { dispatchDueSms } from "@/lib/sms/dispatch";

export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return runCron("sms", async () => {
    const result = await dispatchDueSms();
    return { ok: true, campaigns: result.campaigns, sent: result.sent };
  });
}
