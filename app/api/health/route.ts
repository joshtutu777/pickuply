import { connection } from "next/server";
import { NextResponse } from "next/server";

/**
 * Reports whether the public Supabase API can be reached.
 * The response is only { ok: true } or { ok: false }. No keys, URLs, or error text are returned.
 */
export async function GET() {
  await connection();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ ok: false });
  }

  try {
    const response = await fetch(new URL("/auth/v1/health", url), {
      headers: { apikey: anonKey },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    return NextResponse.json({ ok: response.ok });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
