import { connection } from "next/server";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { connectLivemode } from "@/lib/payments/connect-eligibility";
import { ensureExpressAccount, onboardingLink, requestOrigin } from "@/lib/payments/connect";
import { paymentsMode } from "@/lib/payments/payments-mode";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const origin = requestOrigin(await headers());
  if (!user) return NextResponse.redirect(`${origin}/login?next=/driver/earnings`);
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "driver") return NextResponse.redirect(`${origin}/account?error=forbidden`);
  const { data } = await supabase
    .from("driver_connect_accounts")
    .select("stripe_account_id, details_submitted")
    .eq("driver_id", user.id)
    .eq("livemode", connectLivemode(paymentsMode(process.env.PAYMENTS_MODE)))
    .maybeSingle();
  try {
    const accountId = await ensureExpressAccount(user.id, data?.stripe_account_id ?? null);
    const url = await onboardingLink(accountId, origin, Boolean(data?.details_submitted));
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.redirect(`${origin}/driver/earnings?error=${encodeURIComponent("Payout setup could not be restarted.")}`);
  }
}
