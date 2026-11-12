import "server-only";

import { getStripe } from "@/lib/stripe";

/** A short-lived login link for the driver's Stripe Express dashboard. */
export async function expressDashboardUrl(accountId: string | null | undefined): Promise<string | null> {
  if (!accountId) return null;
  try {
    const link = await getStripe().accounts.createLoginLink(accountId);
    return link.url || null;
  } catch {
    return null;
  }
}
