import type { PaymentsMode } from "@/lib/payments/payments-mode";

/** A Stripe object may be used only in the payment mode that created it. */
export function stripeObjectMatchesMode(mode: PaymentsMode, livemode: boolean): boolean {
  return mode === "live" ? livemode : !livemode;
}

/**
 * Current Stripe types omit `livemode` on some objects that still return it.
 * Missing means the caller decides the fallback.
 */
export function readStripeLivemode(value: object): boolean | null {
  const live = (value as { livemode?: unknown }).livemode;
  return typeof live === "boolean" ? live : null;
}
