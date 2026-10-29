"use server";

import { connection } from "next/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connectLivemode } from "@/lib/payments/connect-eligibility";
import { ensureExpressAccount, onboardingLink, refreshConnectAccount, requestOrigin } from "@/lib/payments/connect";
import { paymentsMode } from "@/lib/payments/payments-mode";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

async function driverAccount() {
  await connection();
  const session = await requireSignedIn("/driver/earnings");
  if (session.role !== "driver") redirect("/account?error=forbidden");
  const supabase = await createClient();
  const { data } = await supabase
    .from("driver_connect_accounts")
    .select("stripe_account_id, details_submitted")
    .eq("driver_id", session.userId)
    .eq("livemode", connectLivemode(paymentsMode(process.env.PAYMENTS_MODE)))
    .maybeSingle();
  return { userId: session.userId, accountId: data?.stripe_account_id ?? null, detailsSubmitted: Boolean(data?.details_submitted) };
}

export async function startPayoutSetup() {
  const driver = await driverAccount();
  const origin = requestOrigin(await headers());
  let url: string;
  try {
    const accountId = await ensureExpressAccount(driver.userId, driver.accountId);
    url = await onboardingLink(accountId, origin, driver.detailsSubmitted);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payout setup could not be started.";
    redirect(`/driver/earnings?error=${encodeURIComponent(message)}`);
  }
  redirect(url);
}

export async function refreshPayoutSetup() {
  const driver = await driverAccount();
  if (!driver.accountId) redirect("/driver/earnings");
  try {
    await refreshConnectAccount(driver.userId, driver.accountId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payout status could not be refreshed.";
    redirect(`/driver/earnings?error=${encodeURIComponent(message)}`);
  }
  redirect("/driver/earnings?saved=1");
}
