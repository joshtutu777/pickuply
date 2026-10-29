import type { PaymentsMode } from "@/lib/payments/payments-mode";

/** A Stripe object may be used only in the payment mode that created it. */
export function stripeObjectMatchesMode(mode: PaymentsMode, livemode: boolean): boolean {
  return mode === "live" ? livemode : !livemode;
}
