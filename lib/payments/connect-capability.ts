import "server-only";

import { transfersCapabilityActive } from "@/lib/payments/object-mode";
import { getStripeForRecordedMode } from "@/lib/stripe";

const previewVersion = "2026-09-30.preview";

type TransfersAccount = {
  configuration?: {
    recipient?: {
      capabilities?: {
        stripe_balance?: {
          stripe_transfers?: { status?: string | null } | null;
        } | null;
      } | null;
    } | null;
  } | null;
};

/** Ask Stripe for the recipient transfers capability. An email is optional. */
export async function requestDriverTransfers(accountId: string, livemode: boolean): Promise<void> {
  await getStripeForRecordedMode(livemode).v2.core.accounts.update(
    accountId,
    {
      configuration: {
        recipient: {
          capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
        },
      },
    },
    { apiVersion: previewVersion },
  );
}

/** The transfers status Stripe reports for this connected account. */
export async function readTransfersActive(accountId: string, livemode: boolean): Promise<boolean> {
  const account = (await getStripeForRecordedMode(livemode).v2.core.accounts.retrieve(
    accountId,
    { include: ["configuration.recipient"] },
    { apiVersion: previewVersion },
  )) as TransfersAccount;
  return transfersCapabilityActive(
    account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status ?? null,
  );
}
