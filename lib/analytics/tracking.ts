export const GTM_CONTAINER_ID = "GTM-WJ6GFSH4";

export const trackingEvents = [
  "page_view",
  "signup_completed",
  "delivery_request_created",
  "offer_received",
  "offer_accepted",
  "booking_confirmed",
  "delivery_completed",
  "driver_registration_completed",
  "driver_application_submitted",
  "driver_approved",
  "driver_offer_submitted",
  "driver_offer_accepted",
  "homepage_booking_click",
  "homepage_driver_click",
  "blog_article_viewed",
  "blog_to_booking_click",
  "blog_to_driver_signup_click",
  "purchase",
] as const;

export type TrackingEvent = (typeof trackingEvents)[number];
export type ConsentChoice = "granted" | "denied";

const blockedFields = new Set([
  "email",
  "phone",
  "name",
  "first_name",
  "last_name",
  "full_name",
  "address",
  "customer_name",
  "token",
  "card",
  "payment_method",
  "body",
  "title",
]);

export function containerId(override?: string | null): string | null {
  const value = (override ?? GTM_CONTAINER_ID).trim();
  return /^GTM-[A-Z0-9]+$/.test(value) ? value : null;
}

export function gtmScriptUrl(id: string): string {
  return `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
}

export function shouldLoadTagManager(input: {
  consent: ConsentChoice | null;
  isTest: boolean;
  loaded: boolean;
}): boolean {
  return input.consent === "granted" && !input.isTest && !input.loaded;
}

export function pagePath(value: string): string | null {
  const path = value.split("?")[0]?.split("#")[0] ?? "";
  if (!path.startsWith("/") || path.length > 120) return null;
  return path;
}

export function nextPageView(lastPath: string | null, path: string): { event: "page_view"; page_path: string } | null {
  const clean = pagePath(path);
  if (!clean || clean === lastPath) return null;
  return { event: "page_view", page_path: clean };
}

export function sanitizeFields(fields: Record<string, unknown>): Record<string, string | number> {
  const clean: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (blockedFields.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      clean[key] = value;
      continue;
    }
    if (typeof value === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(value)) clean[key] = value;
  }
  return clean;
}

export function claimEvent(seen: Set<string>, key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

export function isFreshAccount(createdAt: string | undefined, now = Date.now()): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && now - created >= 0 && now - created < 3 * 60 * 1000;
}

export function bookingEvent(input: {
  returning: boolean;
  paymentStatus: string | null;
  isTest: boolean;
}): { event: "booking_confirmed" } | null {
  if (input.isTest || !input.returning) return null;
  if (input.paymentStatus !== "authorized") return null;
  return { event: "booking_confirmed" };
}

export function deliveryEvent(input: {
  tracked: string | null;
  status: string;
  isTest: boolean;
}): { event: "delivery_completed" } | null {
  if (input.isTest) return null;
  if (input.tracked !== "delivered" || input.status !== "completed") return null;
  return { event: "delivery_completed" };
}

export function purchaseEvent(input: {
  tracked: string | null;
  paymentStatus: string | null;
  capturedCents: number | null;
  live: boolean;
  isTest: boolean;
}): { event: "purchase"; value: number; currency: "USD" } | null {
  if (input.isTest || !input.live || input.tracked !== "delivered") return null;
  if (input.paymentStatus !== "captured") return null;
  if (input.capturedCents == null || input.capturedCents <= 0) return null;
  return { event: "purchase", value: input.capturedCents / 100, currency: "USD" };
}

export function newOfferIds(offers: { offer_id: string; viewed?: boolean }[]): string[] {
  return offers
    .filter((offer) => offer.viewed === false && /^[0-9a-f-]{36}$/i.test(offer.offer_id))
    .map((offer) => offer.offer_id);
}

export function analyticsCookieNames(cookieHeader: string): string[] {
  return cookieHeader
    .split(";")
    .map((part) => part.trim().split("=")[0] ?? "")
    .filter(
      (name) =>
        name === "_ga" ||
        name === "_gid" ||
        name === "_fbp" ||
        name === "_fbc" ||
        name.startsWith("_ga_") ||
        name.startsWith("_gat") ||
        name.startsWith("_gcl_"),
    );
}

export function notificationEvent(kind: string): TrackingEvent | null {
  if (kind === "offer") return "offer_received";
  if (kind === "assigned") return "driver_offer_accepted";
  return null;
}
