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
export function sentToStripeAccount(sentOn: Date): string {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(sentOn);
  return `Sent to your Stripe account on ${date}. Usually in your bank about 2 business days after the job.`;
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
      detail: "This can be sent to your Stripe account. Usually in your bank about 2 business days after the job.",
    };
  }
  if (status === "transferred") {
    return {
      label: "Sent",
      detail: sentOn
        ? sentToStripeAccount(sentOn)
        : "Sent to your Stripe account. Usually in your bank about 2 business days after the job.",
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
