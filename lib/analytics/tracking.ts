export const GTM_CONTAINER_ID = "GTM-WJ6GFSH4";
export const GA4_MEASUREMENT_ID = "G-490EC1PJXG";
export const META_PIXEL_ID = "1129937532824615";

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
  "request_started",
  "request_step",
] as const;

export type TrackingEvent = (typeof trackingEvents)[number];
export type ServiceType = "delivery" | "free_item" | "junk" | "construction";
export type ConversionName = "Lead" | "InitiateCheckout" | "Purchase";

export type ConversionPush = {
  event: ConversionName;
  ga4Event: "generate_lead" | "begin_checkout" | "payment_authorized";
  eventId: string;
  serviceType: ServiceType;
  value?: number;
  currency?: "USD";
};
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
  "description",
  "notes",
  "access_notes",
  "token",
  "card",
  "payment_method",
  "session_id",
  "payment_intent",
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

export function analyticsOpen(input: {
  ready: boolean;
  consent: ConsentChoice | null;
  isTest: boolean;
}): "send" | "skip" | "wait" {
  if (!input.ready) return "wait";
  if (input.consent !== "granted" || input.isTest) return "skip";
  return "send";
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

const serviceTypes = new Set<ServiceType>(["delivery", "free_item", "junk", "construction"]);
const requestStepIds = new Set(["what", "where", "price", "verify"]);

export function serviceType(value: string): ServiceType | null {
  return serviceTypes.has(value as ServiceType) ? (value as ServiceType) : null;
}

export function dollarsFromCents(cents: number): number | null {
  if (!Number.isInteger(cents) || cents <= 0 || cents > 100_000_00) return null;
  return Number((cents / 100).toFixed(2));
}

function jobKey(jobId: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId) ? jobId : null;
}

function attemptKey(attempt: number): string | null {
  return Number.isInteger(attempt) && attempt >= 1 && attempt <= 99 ? String(attempt) : null;
}

export async function opaqueEventId(kind: "l" | "c" | "p", parts: string[]): Promise<string | null> {
  if (parts.some((part) => part.length < 1 || part.length > 80)) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode([kind, ...parts].join("\n")));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
  return `${kind}_${hex}`;
}

export function requestStartEvent(service: string): { event: "request_started"; service_type: ServiceType } | null {
  const service_type = serviceType(service);
  if (!service_type) return null;
  return { event: "request_started", service_type };
}

export function requestStepEvent(
  service: string,
  step: string,
): { event: "request_step"; service_type: ServiceType; step: string } | null {
  const service_type = serviceType(service);
  if (!service_type || !requestStepIds.has(step)) return null;
  return { event: "request_step", service_type, step };
}

export async function leadConversion(input: {
  jobId: string;
  service: string;
  isTest: boolean;
  saved: boolean;
}): Promise<ConversionPush | null> {
  const serviceTypeName = serviceType(input.service);
  const jobId = jobKey(input.jobId);
  if (input.isTest || !input.saved || !serviceTypeName || !jobId) return null;
  const eventId = await opaqueEventId("l", [jobId]);
  if (!eventId) return null;
  return { event: "Lead", ga4Event: "generate_lead", eventId, serviceType: serviceTypeName };
}

export async function checkoutConversion(input: {
  jobId: string;
  attempt: number;
  service: string;
  totalCents: number;
  live: boolean;
  isTest: boolean;
  created: boolean;
}): Promise<ConversionPush | null> {
  const serviceTypeName = serviceType(input.service);
  const jobId = jobKey(input.jobId);
  const attempt = attemptKey(input.attempt);
  const value = dollarsFromCents(input.totalCents);
  if (input.isTest || !input.created || !input.live || !serviceTypeName || !jobId || !attempt || value == null) return null;
  const eventId = await opaqueEventId("c", [jobId, attempt]);
  if (!eventId) return null;
  return {
    event: "InitiateCheckout",
    ga4Event: "begin_checkout",
    eventId,
    serviceType: serviceTypeName,
    value,
    currency: "USD",
  };
}

export async function purchaseConversion(input: {
  jobId: string;
  attempt: number;
  service: string;
  paymentStatus: string | null;
  totalCents: number | null;
  live: boolean;
  isTest: boolean;
}): Promise<ConversionPush | null> {
  const serviceTypeName = serviceType(input.service);
  const jobId = jobKey(input.jobId);
  const attempt = attemptKey(input.attempt);
  const value = input.totalCents == null ? null : dollarsFromCents(input.totalCents);
  if (
    input.isTest ||
    !input.live ||
    input.paymentStatus !== "authorized" ||
    !serviceTypeName ||
    !jobId ||
    !attempt ||
    value == null
  ) {
    return null;
  }
  const eventId = await opaqueEventId("p", [jobId, attempt]);
  if (!eventId) return null;
  return {
    event: "Purchase",
    ga4Event: "payment_authorized",
    eventId,
    serviceType: serviceTypeName,
    value,
    currency: "USD",
  };
}

export function conversionEvents(conversion: ConversionPush): Array<Record<string, string | number>> {
  const fields = sanitizeFields({
    event_id: conversion.eventId,
    ga4_event: conversion.ga4Event,
    service_type: conversion.serviceType,
    value: conversion.value,
    currency: conversion.currency,
  });
  return [{ event: conversion.event, ...fields }];
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
