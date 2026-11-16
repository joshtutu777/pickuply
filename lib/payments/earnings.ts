/** Driver earnings are the agreed pay after a completed delivery. A cancellation or rejection does not earn a penalty. Disposal is not added. */
export function driverEarningCents(input: {
  completed: boolean;
  driverPayCents: number | null;
  tripFeeCents: number | null;
  dumpFeeCents: number | null;
}): number | null {
  void input.tripFeeCents;
  void input.dumpFeeCents;
  if (!input.completed) return null;
  if (input.driverPayCents == null || input.driverPayCents <= 0) return null;
  return input.driverPayCents;
}

export type EarningsAvailability = {
  label: "Held" | "Pending" | "Available" | "Sent";
  detail: string;
};

/** The completion screen uses the ledger status. Held money is not described as a payout. */
export function earningsAvailability(status: string): EarningsAvailability {
  if (status === "held" || status === "held_until_onboarding") {
    return {
      label: "Held",
      detail: "Finish payout setup before this can be sent. This is not an immediate payout.",
    };
  }
  if (status === "ready") {
    return {
      label: "Available",
      detail: "This can be sent to your payout account. A transfer is not a bank deposit.",
    };
  }
  if (status === "transferred" || status === "externally_paid") {
    return {
      label: "Sent",
      detail: "This was sent. A transfer is not a bank deposit.",
    };
  }
  return {
    label: "Pending",
    detail: "This is not paid out yet. It becomes eligible after the hold, and a transfer is not a bank deposit.",
  };
}
