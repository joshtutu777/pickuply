import { formatCents } from "@/lib/money";
import { shortJobId } from "@/lib/jobs/next-action";

/** Bank timing is Stripe's later payout. It is not the transfer. */
export const bankDepositNote =
  "Bank deposits follow Stripe's payout schedule and may take a few additional business days. Check your payout status in Stripe.";

export function sentOnLabel(sentOn: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(sentOn);
}

/** The checkmark line on Earnings. The amount was sent to Stripe, not deposited in a bank. */
export function sentTransferLine(amountCents: number, sentOn: Date): string {
  return `✓ ${formatCents(amountCents)} sent to your Stripe account on ${sentOnLabel(sentOn)}.`;
}

export function transferSentNotice(amountCents: number, jobId: string): string {
  return `Your ${formatCents(amountCents)} for job #${shortJobId(jobId)} was sent to your Stripe account`;
}

/** Driver earnings are the quoted or offered pay, or the trip fee. Disposal is not added. */
export function driverEarningCents(input: {
  completed: boolean;
  driverPayCents: number | null;
  tripFeeCents: number | null;
  dumpFeeCents: number | null;
}): number | null {
  const amount = input.completed ? input.driverPayCents : input.tripFeeCents;
  if (amount == null || amount <= 0) return null;
  return amount;
}

export type EarningsAvailability = {
  label: "Held" | "Pending" | "Available" | "Sent";
  detail: string;
};

/** Sent to the driver's Stripe account. The bank timing is separate and is not the transfer itself. */
export function sentToStripeAccount(sentOn: Date, amountCents?: number): string {
  const lead =
    amountCents == null
      ? `Sent to your Stripe account on ${sentOnLabel(sentOn)}.`
      : sentTransferLine(amountCents, sentOn);
  return `${lead} ${bankDepositNote}`;
}

/** The completion screen uses the ledger status. Held money is not described as a payout. */
export function earningsAvailability(status: string, sentOn?: Date | null): EarningsAvailability {
  if (status === "held" || status === "held_until_onboarding") {
    return {
      label: "Held",
      detail: "Needs payout setup before this can be sent.",
    };
  }
  if (status === "ready") {
    return {
      label: "Available",
      detail: `This can be sent to your Stripe account. ${bankDepositNote}`,
    };
  }
  if (status === "transferred") {
    return {
      label: "Sent",
      detail: sentOn
        ? sentToStripeAccount(sentOn)
        : `Sent to your Stripe account. ${bankDepositNote}`,
    };
  }
  if (status === "externally_paid") {
    return {
      label: "Sent",
      detail: "Paid outside Stripe.",
    };
  }
  return {
    label: "Pending",
    detail: "This is not paid out yet. It becomes eligible after the hold.",
  };
}
