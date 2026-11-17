import "server-only";

import type { FinanceJob, Money } from "@/lib/admin/finance";
import { knownCents } from "@/lib/admin/finance";
import { stripeForJob } from "@/lib/payments/recorded-client";

export type StripeCheck = {
  captured: Money;
  refunded: Money;
  fee: Money;
  transfer: Money;
  note: string;
};

const limit = 30;

export async function compareWithStripe(jobs: FinanceJob[]): Promise<{ checks: Map<string, StripeCheck>; note: string | null }> {
  const checks = new Map<string, StripeCheck>();
  const targets = jobs.filter((job) => job.paymentIntentId).slice(0, limit);
  const note = jobs.filter((job) => job.paymentIntentId).length > limit
    ? `Stripe was read for the first ${limit} PaymentIntents in this list. The rest are unavailable for this view.`
    : null;
  for (const job of targets) {
    try {
      const stripe = await stripeForJob(job.id);
      const intent = await stripe.paymentIntents.retrieve(job.paymentIntentId!, { expand: ["latest_charge.balance_transaction"] });
      const charge = intent.latest_charge && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
      const balance = charge?.balance_transaction && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
      let transfer: Money = { notTracked: true };
      if (job.transferId?.startsWith("tr_")) {
        try {
          const row = await stripe.transfers.retrieve(job.transferId);
          transfer = knownCents(row.amount);
        } catch {
          transfer = { unavailable: true };
        }
      }
      checks.set(job.id, {
        captured: knownCents(intent.amount_received),
        refunded: knownCents(charge?.amount_refunded ?? null),
        fee: balance ? knownCents(balance.fee) : { unavailable: true },
        transfer,
        note: "Read from the payment's Stripe mode.",
      });
    } catch {
      checks.set(job.id, {
        captured: { unavailable: true },
        refunded: { unavailable: true },
        fee: { unavailable: true },
        transfer: { unavailable: true },
        note: "Stripe did not return this PaymentIntent.",
      });
    }
  }
  return { checks, note };
}
