const thirtyMinutes = 30 * 60 * 1000;
const oneDay = 24 * 60 * 60 * 1000;

/** Stripe Checkout cannot expire sooner than 30 minutes. A later authorization still follows the job deadline. */
export function checkoutExpiresAt(dueAtMs: number, nowMs: number): number {
  const earliest = nowMs + thirtyMinutes;
  const latest = nowMs + oneDay;
  const chosen = Math.min(Math.max(dueAtMs, earliest), latest);
  const seconds = Math.ceil(chosen / 1000);
  const minimum = Math.floor(nowMs / 1000) + 30 * 60 + 1;
  return Math.max(seconds, minimum);
}
