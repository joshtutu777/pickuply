import "server-only";

import type Stripe from "stripe";
import { readTransfersActive, requestDriverTransfers } from "@/lib/payments/connect-capability";
import { connectAccountLivemode } from "@/lib/payments/object-mode";
import { currentStripeLivemode } from "@/lib/payments/payments-mode";
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
  const clientLive = currentStripeLivemode();
  const accountLive = connectAccountLivemode(account, clientLive);
  if (accountLive == null) {
    throw new Error("This payout account does not match the current payment mode.");
  }
  const transfersActive = await readTransfersActive(account.id, accountLive);
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("upsert_connect_account", {
    target_driver: driverId,
    account_id: account.id,
    account_livemode: accountLive,
    charges_enabled: Boolean(account.charges_enabled),
    payouts_enabled: Boolean(account.payouts_enabled),
    details_submitted: Boolean(account.details_submitted),
    requirements_due: account.requirements?.currently_due ?? [],
    disabled_reason: account.requirements?.disabled_reason ?? null,
    transfers_active: transfersActive,
  });
  if (error) throw new Error("The payout account could not be saved.");
}

const previewVersion = "2026-09-30.preview";

export async function ensureExpressAccount(driverId: string, existingId: string | null): Promise<string> {
  const live = currentStripeLivemode();
  const stripe = getStripe();
  if (existingId) {
    await requestDriverTransfers(existingId, live);
    const account = await stripe.accounts.retrieve(existingId);
    await saveConnectAccount(driverId, account);
    return account.id;
  }
  // Accounts v2 with Managed Risk. Stripe collects losses.
  // The customer's card is still charged on the platform account. This account only receives transfers.
  // The mode is part of the idempotency key so a test account is not reused for a live driver.
  const created = await stripe.v2.core.accounts.create(
    {
      dashboard: "express",
      identity: { country: "US" },
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
      },
      defaults: {
        responsibilities: {
          fees_collector: "stripe",
          losses_collector: "stripe",
        },
      },
      metadata: { driver_id: driverId },
    },
    { apiVersion: previewVersion, idempotencyKey: `connect-account:${driverId}:${live ? "live" : "test"}` },
  );
  await requestDriverTransfers(created.id, live);
  const account = await stripe.accounts.retrieve(created.id);
  await saveConnectAccount(driverId, account);
  return account.id;
}

export async function refreshConnectAccount(driverId: string, accountId: string): Promise<Stripe.Account> {
  const live = currentStripeLivemode();
  const stripe = getStripe();
  let account = await stripe.accounts.retrieve(accountId);
  const owner = account.metadata?.driver_id;
  if (owner && owner !== driverId) {
    throw new Error("This payout account belongs to someone else.");
  }
  await requestDriverTransfers(accountId, live);
  account = await stripe.accounts.retrieve(accountId);
  await saveConnectAccount(driverId, account);
  return account;
}

export async function onboardingLink(accountId: string, origin: string, detailsSubmitted: boolean): Promise<string> {
  const refreshUrl = `${origin}/driver/earnings/refresh`;
  const returnUrl = `${origin}/driver/earnings?connect=return`;
  const link = await getStripe().v2.core.accountLinks.create(
    {
      account: accountId,
      use_case: detailsSubmitted
        ? { type: "account_update", account_update: { refresh_url: refreshUrl, return_url: returnUrl } }
        : { type: "account_onboarding", account_onboarding: { refresh_url: refreshUrl, return_url: returnUrl } },
    },
    {
      apiVersion: previewVersion,
      idempotencyKey: `connect-link:${accountId}:${detailsSubmitted ? "update" : "onboard"}:${Math.floor(Date.now() / 60000)}`,
    },
  );
  if (!link.url) throw new Error("Stripe did not return a setup link.");
  return link.url;
}

export function requestOrigin(headerList: Headers): string {
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  if (!host) return "http://localhost:3000";
  const normalized = host.replace(/^127\.0\.0\.1(?=:|$)/, "localhost");
  return `${proto}://${normalized}`;
}
