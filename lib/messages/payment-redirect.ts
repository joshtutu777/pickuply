export const offPlatformWarning = "Payments must go through Pickuply so you're protected.";

const offPlatform =
  /\b(venmo|cash\s*app|cashapp|zelle|paypal)\b|\bpay\s+cash\b|\bpay\s+me\s+directly\b/i;

/** True when a message tries to move the payment off Pickuply. */
export function redirectsPayment(value: string): boolean {
  return offPlatform.test(value);
}
