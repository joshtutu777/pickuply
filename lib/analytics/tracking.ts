export const GTM_CONTAINER_ID = "GTM-WJ6GFSH4";
export const consentStorageKey = "pickuply-analytics-consent";

export type ConsentChoice = "granted" | "denied";

const blockedFields = new Set([
  "email",
  "phone",
  "name",
  "first_name",
  "last_name",
  "full_name",
  "address",
  "street",
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

export function storedConsent(value: string | null): ConsentChoice | null {
  return value === "granted" || value === "denied" ? value : null;
}

/** Tag Manager stays unloaded until the saved choice allows it. A test account never loads it. */
export function shouldLoadTagManager(input: {
  consent: ConsentChoice | null;
  isTest: boolean;
  loaded: boolean;
}): boolean {
  return input.consent === "granted" && !input.isTest && !input.loaded;
}

export type ConsentState = {
  ad_storage: "granted" | "denied";
  ad_user_data: "granted" | "denied";
  ad_personalization: "granted" | "denied";
  analytics_storage: "granted" | "denied";
  functionality_storage: "denied";
  personalization_storage: "denied";
  security_storage: "granted";
};

const deniedConsent: ConsentState = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
  functionality_storage: "denied",
  personalization_storage: "denied",
  security_storage: "granted",
};

/** The existing Allow choice covers analytics and advertising. Reject turns both off. */
export function consentState(choice: ConsentChoice): ConsentState {
  if (choice === "denied") return deniedConsent;
  return {
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
    analytics_storage: "granted",
    functionality_storage: "denied",
    personalization_storage: "denied",
    security_storage: "granted",
  };
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

/** A booking card hold is not a purchase. */
export function purchaseForBookingHold(): null {
  return null;
}

export function tipPurchaseEvent(input: {
  tipId: string | null;
  amountCents: number | null;
  paid: boolean;
  isTest: boolean;
}): { event: "purchase"; transaction_id: string; value: number; currency: "USD" } | null {
  if (input.isTest || !input.paid) return null;
  if (!input.tipId || !/^[0-9a-f-]{36}$/i.test(input.tipId)) return null;
  if (input.amountCents == null || !Number.isInteger(input.amountCents) || input.amountCents < 100) return null;
  return {
    event: "purchase",
    transaction_id: input.tipId,
    value: input.amountCents / 100,
    currency: "USD",
  };
}
