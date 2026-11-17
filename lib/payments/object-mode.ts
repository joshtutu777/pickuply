/**
 * Current Stripe types omit `livemode` on some objects that still return it.
 * Missing means the caller decides the fallback.
 */
export function readStripeLivemode(value: object): boolean | null {
  const live = (value as { livemode?: unknown }).livemode;
  return typeof live === "boolean" ? live : null;
}

/**
 * The current Stripe account response does not include livemode.
 * A successful retrieve can only return an account for the key that asked,
 * so a missing flag uses that key's mode. A flag that disagrees with the key is rejected.
 */
/** Stripe's recipient transfers capability is ready only when its status is active. */
export function transfersCapabilityActive(status: string | null | undefined): boolean {
  return status === "active";
}

export function connectAccountLivemode(account: object, clientLive: boolean): boolean | null {
  const recorded = readStripeLivemode(account);
  if (recorded == null) return clientLive;
  return recorded === clientLive ? recorded : null;
}
