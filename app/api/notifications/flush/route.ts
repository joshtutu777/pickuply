import { connection } from "next/server";
import { NextResponse } from "next/server";
import { getOptionalSession } from "@/lib/auth/session";
import { flushTransactionalSms } from "@/lib/notifications/transactional-send";

/** A signed-in person can ask for waiting booking texts to go out. A failure here does not undo the booking. */
export async function POST() {
  await connection();
  const session = await getOptionalSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  await flushTransactionalSms();
  return NextResponse.json({ ok: true });
}
