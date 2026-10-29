import "server-only";

import { transfersCapabilityActive } from "@/lib/payments/transfer-readiness";
import { getStripe } from "@/lib/stripe";

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
export async function requestDriverTransfers(accountId: string, email?: string | null): Promise<void> {
  await getStripe().v2.core.accounts.update(
    accountId,
    {
      ...(email ? { contact_email: email } : {}),
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
export async function readTransfersStatus(accountId: string): Promise<string | null> {
  const account = (await getStripe().v2.core.accounts.retrieve(
    accountId,
    { include: ["configuration.recipient"] },
    { apiVersion: previewVersion },
  )) as TransfersAccount;
  return account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status ?? null;
}

export async function readTransfersActive(accountId: string): Promise<boolean> {
  return transfersCapabilityActive(await readTransfersStatus(accountId));
}
