import "server-only";

import type Stripe from "stripe";
import { accountLinkKind, fallbackAccountLinkKind, type AccountLinkKind } from "@/lib/payments/account-link";
import { alertPaymentsIssue } from "@/lib/payments/mode-alert";
import { alignPaymentsMode } from "@/lib/payments/mode-sync";
import { readStripeLivemode } from "@/lib/payments/object-mode";
import { readTransfersActive, requestDriverTransfers } from "@/lib/payments/connect-capability";
import { PAYOUT_EMAIL_REQUIRED, payoutContactEmail } from "@/lib/payments/payout-contact-email";
import { reportPayoutSetupFailure } from "@/lib/payments/payout-setup-result";
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
  const accountLive = readStripeLivemode(account);
  if (accountLive == null) {
    await alertPaymentsIssue(
      `connect-account-mode:${account.id}`,
      "Payout account mode missing",
      "A payout account had no Stripe mode. It was not saved.",
    );
    throw new Error("This payout account has no recorded Stripe mode.");
  }
  const payoutsEnabled = Boolean(account.payouts_enabled);
  const transfersActive = await readTransfersActive(account.id, accountLive);
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
  const supabase = createServiceClient();
  const [{ data, error }, profile] = await Promise.all([
    supabase.auth.admin.getUserById(driverId),
    supabase.from("profiles").select("email").eq("id", driverId).maybeSingle(),
  ]);
  const user = error ? null : data.user;
  return payoutContactEmail({
    authEmail: user?.email,
    authEmailConfirmed: Boolean(user?.email_confirmed_at),
    profileEmail: profile.data?.email,
  });
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
    let account: Stripe.Account;
    try {
      account = await getStripe().accounts.retrieve(existingId);
    } catch (error) {
      reportPayoutSetupFailure("stripe_account_create", error);
      throw error;
    }
    let saved: { payoutsEnabled: boolean; transfersActive: boolean };
    try {
      saved = await saveConnectAccount(driverId, account);
    } catch (error) {
      reportPayoutSetupFailure("account_save", error);
      throw error;
    }
    if (saved.payoutsEnabled && saved.transfersActive) {
      try {
        await sendReadyTransfers({ driverId });
      } catch {
        // The 15-minute transfer job retries a row that is ready and not held.
      }
    }
    return existingId;
  }
  if (!email) throw new Error(PAYOUT_EMAIL_REQUIRED);
  const stripe = getStripe();
  // This test platform uses Accounts v2 with Managed Risk. Stripe must collect losses.
  // The customer's card is charged on the platform. The driver account receives transfers.
  let created: { id: string };
  try {
    created = await stripe.v2.core.accounts.create(
      {
        contact_email: email,
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
  } catch (error) {
    reportPayoutSetupFailure("stripe_account_create", error);
    throw error;
  }
  let account: Stripe.Account;
  try {
    account = await stripe.accounts.retrieve(created.id);
  } catch (error) {
    reportPayoutSetupFailure("stripe_account_create", error);
    throw error;
  }
  try {
    await saveConnectAccount(driverId, account);
  } catch (error) {
    reportPayoutSetupFailure("account_save", error);
    throw error;
  }
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
    if (!fallback) {
      reportPayoutSetupFailure("stripe_account_link", error);
      throw error;
    }
    try {
      return await createAccountLink(accountId, origin, fallback);
    } catch (fallbackError) {
      reportPayoutSetupFailure("stripe_account_link", fallbackError);
      throw fallbackError;
    }
  }
}

export function requestOrigin(headerList: Headers): string {
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  if (!host) return "http://localhost:3000";
  const normalized = host.replace(/^127\.0\.0\.1(?=:|$)/, "localhost");
  return `${proto}://${normalized}`;
}
