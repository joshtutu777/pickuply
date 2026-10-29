import { driverNeedsLivePayouts, type PaymentsMode } from "@/lib/payments/payments-mode";

/** The stored Connect row belongs to this payment mode. A test account id is not a live account. */
export function sameModeConnectAccount(mode: PaymentsMode, accountLivemode: boolean): boolean {
  return mode === "live" ? accountLivemode : !accountLivemode;
}

export function connectLivemode(mode: PaymentsMode): boolean {
  return mode === "live";
}

/**
 * Test mode keeps the current accept rule.
 * Live mode lets a real driver accept a paid job only with a live account whose payouts and transfers are both active.
 */
export function liveDriverCanAccept(input: {
  mode: PaymentsMode;
  isTestDriver: boolean;
  payoutsEnabled: boolean;
  transfersActive: boolean;
  accountLivemode: boolean;
}): boolean {
  if (!driverNeedsLivePayouts(input.mode, input.isTestDriver)) return true;
  return input.payoutsEnabled && input.transfersActive && input.accountLivemode;
}

export function payoutRequirementNote(mode: PaymentsMode, ready: boolean): string {
  if (mode === "live" && ready) {
    return "Stripe can send your earnings to your live Stripe account. Bank deposits follow Stripe's payout schedule and may take a few additional business days.";
  }
  if (mode === "live") {
    return "Set up payouts before you accept paid jobs. Stripe has to enable payouts and transfers on a live account. A test payout account cannot be used for live jobs.";
  }
  if (ready) {
    return "Stripe can send your earnings to your Stripe account. Bank deposits follow Stripe's payout schedule and may take a few additional business days.";
  }
  return "You can still take jobs. Earnings stay held until Stripe can pay you, unless an admin records an outside payment.";
}
