import "server-only";

import type Stripe from "stripe";
import { accountLinkKind, fallbackAccountLinkKind, type AccountLinkKind } from "@/lib/payments/account-link";
import { alertPaymentsIssue } from "@/lib/payments/mode-alert";
import { alignPaymentsMode } from "@/lib/payments/mode-sync";
import { stripeObjectMatchesMode } from "@/lib/payments/object-mode";
import { paymentsMode } from "@/lib/payments/payments-mode";
import { readTransfersActive, requestDriverTransfers } from "@/lib/payments/connect-capability";
import { sendReadyTransfers } from "@/lib/payments/transfers";
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

export async function saveConnectAccount(
  driverId: string,
  account: Stripe.Account,
): Promise<{ payoutsEnabled: boolean; transfersActive: boolean }> {
  const mode = paymentsMode(process.env.PAYMENTS_MODE);
  const accountLive = typeof account.livemode === "boolean" ? account.livemode : mode === "live";
  if (!stripeObjectMatchesMode(mode, accountLive)) {
    await alertPaymentsIssue(
      `connect-account-mode:${account.id}`,
      "Payout account mode mismatch",
      "A payout account did not match the payment switch. It was not saved.",
    );
    throw new Error("This payout account does not match the current payment mode.");
  }
  const payoutsEnabled = Boolean(account.payouts_enabled);
  const transfersActive = await readTransfersActive(account.id);
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("upsert_connect_account", {
    target_driver: driverId,
    account_id: account.id,
    charges_enabled: Boolean(account.charges_enabled),
    payouts_enabled: payoutsEnabled,
    details_submitted: Boolean(account.details_submitted),
    requirements_due: account.requirements?.currently_due ?? [],
    disabled_reason: account.requirements?.disabled_reason ?? null,
    transfers_active: transfersActive,
    account_livemode: accountLive,
  });
  if (error) throw new Error("The payout account could not be saved.");
  return { payoutsEnabled, transfersActive };
}

const previewVersion = "2026-09-30.preview";

async function contactEmail(driverId: string): Promise<string | null> {
  const { data, error } = await createServiceClient().auth.admin.getUserById(driverId);
  if (error) return null;
  const email = data.user?.email?.trim();
  return email || null;
}

export async function ensureExpressAccount(driverId: string, existingId: string | null): Promise<string> {
  const aligned = await alignPaymentsMode();
  if (!aligned.matches) throw new Error("Payments are paused. Try again in a few minutes.");
  const email = await contactEmail(driverId);
  if (existingId) {
    try {
      await requestDriverTransfers(existingId, email);
    } catch {
      // The setup link can still open if Stripe already has this capability.
    }
    const account = await getStripe().accounts.retrieve(existingId);
    const saved = await saveConnectAccount(driverId, account);
    if (saved.payoutsEnabled && saved.transfersActive) {
      try {
        await sendReadyTransfers({ driverId });
      } catch {
        // The 15-minute transfer job retries a row that is ready and not held.
      }
    }
    return existingId;
  }
  const stripe = getStripe();
  // This test platform uses Accounts v2 with Managed Risk. Stripe must collect losses.
  // The customer's card is charged on the platform. The driver account receives transfers.
  const created = await stripe.v2.core.accounts.create(
    {
      ...(email ? { contact_email: email } : {}),
      dashboard: "express",
      identity: { country: "US" },
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
      },
      defaults: {
        responsibilities: {
          fees_collector: "stripe",
          losses_collector: "stripe",
        },
      },
      metadata: { driver_id: driverId },
    },
    { apiVersion: previewVersion, idempotencyKey: `connect-account:${driverId}` },
  );
  const account = await stripe.accounts.retrieve(created.id);
  await saveConnectAccount(driverId, account);
  return account.id;
}

export async function refreshConnectAccount(driverId: string, accountId: string): Promise<Stripe.Account> {
  let account = await getStripe().accounts.retrieve(accountId);
  const owner = account.metadata?.driver_id;
  if (owner && owner !== driverId) {
    throw new Error("This payout account belongs to someone else.");
  }
  const email = account.email ?? (await contactEmail(driverId));
  try {
    await requestDriverTransfers(accountId, email);
    account = await getStripe().accounts.retrieve(accountId);
  } catch {
    // Keep the account Stripe already returned.
  }
  const saved = await saveConnectAccount(driverId, account);
  if (saved.payoutsEnabled && saved.transfersActive) {
    try {
      await sendReadyTransfers({ driverId });
    } catch {
      // The 15-minute transfer job retries a row that is ready and not held.
    }
  }
  return account;
}

async function createAccountLink(accountId: string, origin: string, kind: AccountLinkKind): Promise<string> {
  const refreshUrl = `${origin}/driver/earnings/refresh`;
  const returnUrl = `${origin}/driver/earnings?connect=return`;
  const link = await getStripe().v2.core.accountLinks.create(
    {
      account: accountId,
      use_case:
        kind === "account_update"
          ? { type: "account_update", account_update: { refresh_url: refreshUrl, return_url: returnUrl } }
          : { type: "account_onboarding", account_onboarding: { refresh_url: refreshUrl, return_url: returnUrl } },
    },
    {
      apiVersion: previewVersion,
      idempotencyKey: `connect-link:${accountId}:${kind}:${Math.floor(Date.now() / 60000)}`,
    },
  );
  if (!link.url) throw new Error("Stripe did not return a setup link.");
  return link.url;
}

export async function onboardingLink(accountId: string, origin: string, detailsSubmitted: boolean): Promise<string> {
  const preferred = accountLinkKind(detailsSubmitted);
  try {
    return await createAccountLink(accountId, origin, preferred);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const fallback = fallbackAccountLinkKind(preferred, message);
    if (!fallback) throw error;
    return createAccountLink(accountId, origin, fallback);
  }
}

export function requestOrigin(headerList: Headers): string {
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  if (!host) return "http://localhost:3000";
  const normalized = host.replace(/^127\.0\.0\.1(?=:|$)/, "localhost");
  return `${proto}://${normalized}`;
}
