import { connection } from "next/server";
import { NextResponse } from "next/server";
import { flushTransactionalSms } from "@/lib/notifications/transactional-send";

export const maxDuration = 60;

/** Continues a driver-text queue immediately. The five-minute schedule is only the fallback. */
export async function POST(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const texts = await flushTransactionalSms();
  return NextResponse.json({ ok: true, ...texts });
}
