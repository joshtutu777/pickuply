import "server-only";

import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";

export type ConnectRow = {
  driver_id: string;
  stripe_account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements_due: string[];
  disabled_reason: string | null;
  synced_at: string | null;
};

export async function saveConnectAccount(driverId: string, account: Stripe.Account): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("upsert_connect_account", {
    target_driver: driverId,
    account_id: account.id,
    charges_enabled: Boolean(account.charges_enabled),
    payouts_enabled: Boolean(account.payouts_enabled),
    details_submitted: Boolean(account.details_submitted),
    requirements_due: account.requirements?.currently_due ?? [],
    disabled_reason: account.requirements?.disabled_reason ?? null,
  });
  if (error) throw new Error("The payout account could not be saved.");
}

export async function ensureExpressAccount(driverId: string, existingId: string | null): Promise<string> {
  if (existingId) return existingId;
  const account = await getStripe().accounts.create(
    {
      type: "express",
      country: "US",
      capabilities: { transfers: { requested: true } },
      metadata: { driver_id: driverId },
    },
    { idempotencyKey: `connect-account:${driverId}` },
  );
  await saveConnectAccount(driverId, account);
  return account.id;
}

export async function refreshConnectAccount(driverId: string, accountId: string): Promise<Stripe.Account> {
  const account = await getStripe().accounts.retrieve(accountId);
  const owner = account.metadata?.driver_id;
  if (owner && owner !== driverId) {
    throw new Error("This payout account belongs to someone else.");
  }
  await saveConnectAccount(driverId, account);
  return account;
}

export async function onboardingLink(accountId: string, origin: string, detailsSubmitted: boolean): Promise<string> {
  const link = await getStripe().accountLinks.create(
    {
      account: accountId,
      type: detailsSubmitted ? "account_update" : "account_onboarding",
      refresh_url: `${origin}/driver/earnings/refresh`,
      return_url: `${origin}/driver/earnings?connect=return`,
    },
    { idempotencyKey: `connect-link:${accountId}:${detailsSubmitted ? "update" : "onboard"}:${Math.floor(Date.now() / 60000)}` },
  );
  if (!link.url) throw new Error("Stripe did not return a setup link.");
  return link.url;
}

export function requestOrigin(headerList: Headers): string {
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  if (!host) return "http://127.0.0.1:3000";
  return `${proto}://${host}`;
}
