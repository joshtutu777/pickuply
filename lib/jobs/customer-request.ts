const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function customerRequestEntry(id: string, signedIn: boolean): "invalid" | "sign-in" | "show" {
  if (!JOB_ID.test(id)) return "invalid";
  if (!signedIn) return "sign-in";
  return "show";
}

export function emptyOfferMessage(status: string): string {
  if (status === "open" || status === "quoted") {
    return "No offers are open right now. An offer stays open for 2 hours. Your request is still here, and a driver can send a new one.";
  }
  return "No offers are open right now.";
}

/** Push notifications must open a full address. A relative path can open a blank window on a phone. */
export function notificationWindowUrl(href: string, origin: string): string {
  const fallback = new URL("/account/notifications", origin).href;
  if (!href.startsWith("/") || href.startsWith("//")) return fallback;
  try {
    const url = new URL(href, origin);
    if (url.origin !== new URL(origin).origin) return fallback;
    return url.href;
  } catch {
    return fallback;
  }
}
