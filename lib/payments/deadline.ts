const leaveOpen = new Set(["requires_capture", "processing", "succeeded"]);

export type OverduePaymentRow = {
  jobId: string;
  paymentIntentId: string | null;
  recordedLivemode: boolean | null;
};

export type DeadlineStripe = {
  retrievePaymentIntent(id: string): Promise<{ status: string; livemode: boolean }>;
  cancelPaymentIntent(id: string): Promise<void>;
};

export type DeadlineOutcome =
  | "released"
  | "left_open"
  | "missing_mode"
  | "mode_mismatch"
  | "stripe_failed"
  | "already_released";

/**
 * Closes one unpaid assignment from the mode saved on that payment.
 * A Stripe failure does not release the driver. A second pass does not cancel again.
 */
export async function settleOverduePayment(
  row: OverduePaymentRow,
  stripeFor: (livemode: boolean) => DeadlineStripe,
  release: (jobId: string) => Promise<boolean>,
): Promise<DeadlineOutcome> {
  if (!row.paymentIntentId) {
    return (await release(row.jobId)) ? "released" : "already_released";
  }
  if (row.recordedLivemode == null) return "missing_mode";

  let stripe: DeadlineStripe;
  let intent: { status: string; livemode: boolean };
  try {
    stripe = stripeFor(row.recordedLivemode);
    intent = await stripe.retrievePaymentIntent(row.paymentIntentId);
  } catch {
    return "stripe_failed";
  }
  if (intent.livemode !== row.recordedLivemode) return "mode_mismatch";
  if (leaveOpen.has(intent.status)) return "left_open";

  if (intent.status !== "canceled") {
    try {
      await stripe.cancelPaymentIntent(row.paymentIntentId);
    } catch {
      return "stripe_failed";
    }
  }
  return (await release(row.jobId)) ? "released" : "already_released";
}

export async function settleOverduePayments(
  rows: OverduePaymentRow[],
  stripeFor: (livemode: boolean) => DeadlineStripe,
  release: (jobId: string) => Promise<boolean>,
): Promise<DeadlineOutcome[]> {
  const outcomes: DeadlineOutcome[] = [];
  for (const row of rows) outcomes.push(await settleOverduePayment(row, stripeFor, release));
  return outcomes;
}
