import { connection } from "next/server";
import { NextResponse } from "next/server";
import { runCron } from "@/lib/cron/record";
import { sendReadyTransfers } from "@/lib/payments/transfers";

// Local check: curl -H "Authorization: Bearer <CRON_SECRET>" http://127.0.0.1:3000/api/cron/transfers

export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return runCron("transfers", async () => {
    const limit = await sendReadyTransfers();
    return { ok: true, limit };
  });
}
