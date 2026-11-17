import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  analyticsCookieNames,
  analyticsOpen,
  bookingEvent,
  checkoutConversion,
  claimEvent,
  containerId,
  conversionEvents,
  deliveryEvent,
  dollarsFromCents,
  GA4_MEASUREMENT_ID,
  GTM_CONTAINER_ID,
  isFreshAccount,
  leadConversion,
  META_PIXEL_ID,
  newOfferIds,
  nextPageView,
  notificationEvent,
  opaqueEventId,
  purchaseConversion,
  requestStartEvent,
  requestStepEvent,
  sanitizeFields,
  serviceType,
  shouldLoadTagManager,
} from "./tracking";

const job = "11111111-1111-4111-8111-111111111111";
const services = ["delivery", "free_item", "junk", "construction"] as const;

function expectedId(kind: "l" | "c" | "p", parts: string[]): string {
  return `${kind}_${createHash("sha256").update([kind, ...parts].join("\n")).digest("hex").slice(0, 32)}`;
}

test("the tag manager container id is the only script id", () => {
  assert.equal(containerId(), GTM_CONTAINER_ID);
  assert.equal(GTM_CONTAINER_ID, "GTM-WJ6GFSH4");
  assert.equal(GA4_MEASUREMENT_ID, "G-490EC1PJXG");
  assert.equal(META_PIXEL_ID, "1129937532824615");
  assert.equal(containerId(GA4_MEASUREMENT_ID), null);
  assert.equal(containerId(META_PIXEL_ID), null);
});

test("tag manager loads once after consent and stays off for a test account", () => {
  assert.equal(shouldLoadTagManager({ consent: null, isTest: false, loaded: false }), false);
  assert.equal(shouldLoadTagManager({ consent: "denied", isTest: false, loaded: false }), false);
  assert.equal(shouldLoadTagManager({ consent: "granted", isTest: true, loaded: false }), false);
  assert.equal(shouldLoadTagManager({ consent: "granted", isTest: false, loaded: false }), true);
  assert.equal(shouldLoadTagManager({ consent: "granted", isTest: false, loaded: true }), false);
  assert.equal(analyticsOpen({ ready: false, consent: "granted", isTest: false }), "wait");
  assert.equal(analyticsOpen({ ready: true, consent: null, isTest: false }), "skip");
  assert.equal(analyticsOpen({ ready: true, consent: "denied", isTest: false }), "skip");
  assert.equal(analyticsOpen({ ready: true, consent: "granted", isTest: true }), "skip");
  assert.equal(analyticsOpen({ ready: true, consent: "granted", isTest: false }), "send");
});

test("a route is recorded once and query strings stay off the path", () => {
  assert.deepEqual(nextPageView(null, "/blog/sofa-guide?x=1"), {
    event: "page_view",
    page_path: "/blog/sofa-guide",
  });
  assert.equal(nextPageView("/blog/sofa-guide", "/blog/sofa-guide"), null);
  assert.deepEqual(nextPageView("/blog/sofa-guide", "/request"), {
    event: "page_view",
    page_path: "/request",
  });
});

test("personal fields are left out of the event", () => {
  assert.deepEqual(
    sanitizeFields({
      service: "delivery",
      email: "a@example.com",
      phone: "5555550100",
      address: "1 Main St",
      name: "Ada",
      title: "New offer",
      body: "Open the request",
    }),
    { service: "delivery" },
  );
});

test("booking is the card hold and purchase is the live authorization", async () => {
  assert.deepEqual(bookingEvent({ returning: true, paymentStatus: "authorized", isTest: false }), {
    event: "booking_confirmed",
  });
  assert.equal(bookingEvent({ returning: true, paymentStatus: "captured", isTest: false }), null);
  assert.equal(bookingEvent({ returning: true, paymentStatus: "paid", isTest: false }), null);
  assert.equal(bookingEvent({ returning: true, paymentStatus: "awaiting_payment", isTest: false }), null);
  assert.equal(bookingEvent({ returning: true, paymentStatus: "authorized", isTest: true }), null);
  assert.equal((5250 / 100).toFixed(2), "52.50");
  assert.equal(dollarsFromCents(5250), 52.5);
  assert.equal(dollarsFromCents(0), null);

  for (const service of services) {
    assert.equal(serviceType(service), service);
    assert.deepEqual(requestStartEvent(service), { event: "request_started", service_type: service });
    const lead = await leadConversion({ jobId: job, service, isTest: false, saved: true });
    assert.equal(lead?.event, "Lead");
    assert.equal(lead?.ga4Event, "generate_lead");
    assert.equal(lead?.serviceType, service);
    assert.equal(lead?.eventId, expectedId("l", [job]));
    assert.equal(lead?.eventId.includes(job), false);
  }
  assert.equal(requestStartEvent("store_pickup"), null);
  assert.deepEqual(requestStepEvent("delivery", "where"), {
    event: "request_step",
    service_type: "delivery",
    step: "where",
  });
  assert.equal(requestStepEvent("delivery", "1 Main St"), null);
  assert.equal(await leadConversion({ jobId: job, service: "delivery", isTest: true, saved: true }), null);
  assert.equal(await leadConversion({ jobId: job, service: "delivery", isTest: false, saved: false }), null);
  assert.equal(await leadConversion({ jobId: "not-a-job", service: "delivery", isTest: false, saved: true }), null);
  assert.equal(await leadConversion({ jobId: job, service: "sofa notes", isTest: false, saved: true }), null);

  assert.equal(
    await checkoutConversion({
      jobId: job,
      attempt: 1,
      service: "junk",
      totalCents: 5250,
      live: true,
      isTest: false,
      created: false,
    }),
    null,
  );
  assert.equal(
    await checkoutConversion({
      jobId: job,
      attempt: 1,
      service: "junk",
      totalCents: 5250,
      live: false,
      isTest: false,
      created: true,
    }),
    null,
  );
  const checkout = await checkoutConversion({
    jobId: job,
    attempt: 1,
    service: "junk",
    totalCents: 5250,
    live: true,
    isTest: false,
    created: true,
  });
  const retry = await checkoutConversion({
    jobId: job,
    attempt: 2,
    service: "junk",
    totalCents: 5250,
    live: true,
    isTest: false,
    created: true,
  });
  assert.equal(checkout?.event, "InitiateCheckout");
  assert.equal(checkout?.ga4Event, "begin_checkout");
  assert.equal(checkout?.value, 52.5);
  assert.equal(checkout?.currency, "USD");
  assert.equal(checkout?.eventId, expectedId("c", [job, "1"]));
  assert.notEqual(checkout?.eventId, retry?.eventId);
  assert.equal(await opaqueEventId("c", [job, "1"]), checkout?.eventId);

  const held = {
    jobId: job,
    attempt: 3,
    service: "construction",
    totalCents: 5250,
    live: true,
    isTest: false,
  };
  assert.equal(await purchaseConversion({ ...held, paymentStatus: "failed" }), null);
  assert.equal(await purchaseConversion({ ...held, paymentStatus: "captured" }), null);
  assert.equal(await purchaseConversion({ ...held, paymentStatus: "authorized", live: false }), null);
  assert.equal(await purchaseConversion({ ...held, paymentStatus: "authorized", isTest: true }), null);
  assert.equal(await purchaseConversion({ ...held, paymentStatus: "authorized", attempt: 0 }), null);
  const purchase = await purchaseConversion({ ...held, paymentStatus: "authorized" });
  assert.deepEqual(conversionEvents(purchase!), [
    {
      event: "Purchase",
      event_id: expectedId("p", [job, "3"]),
      ga4_event: "payment_authorized",
      service_type: "construction",
      value: 52.5,
      currency: "USD",
    },
  ]);
  assert.equal(conversionEvents(purchase!).length, 1);
  assert.equal(JSON.stringify(conversionEvents(purchase!)).includes(job), false);
  assert.deepEqual(
    sanitizeFields({
      event_id: purchase!.eventId,
      email: "a@example.com",
      phone: "5555550100",
      address: "1 Main St",
      description: "old couch by the door",
      notes: "gate code 1234",
      value: 52.5,
    }),
    { event_id: purchase!.eventId, value: 52.5 },
  );
  const seen = new Set<string>();
  assert.equal(claimEvent(seen, purchase!.eventId), true);
  assert.equal(claimEvent(seen, purchase!.eventId), false);
});

test("conversion calls sit after the business action succeeds", () => {
  const wizard = readFileSync(new URL("../../components/request/request-wizard.tsx", import.meta.url), "utf8");
  const pay = readFileSync(new URL("../../components/request/pay-panel.tsx", import.meta.url), "utf8");
  const signals = readFileSync(new URL("../../components/analytics/job-signals.tsx", import.meta.url), "utf8");
  assert.ok(wizard.indexOf("await createRequest") < wizard.indexOf("setSentId(job.id)"));
  assert.ok(wizard.indexOf("setSentId(job.id)") < wizard.indexOf("await leadConversion"));
  assert.equal(wizard.includes("saved: true"), true);
  assert.equal(wizard.includes("trackSavedRequest"), true);
  assert.ok(pay.indexOf("await startCheckout") < pay.indexOf("await checkoutConversion"));
  assert.equal(pay.includes("onSubmit"), false);
  assert.equal(signals.includes("paid=return"), false);
  assert.equal(signals.includes("subscribeTracking"), true);
  assert.equal(signals.includes("purchaseConversion"), true);
  const container = readFileSync(new URL("../../gtm/pickuply-conversion-workspace.json", import.meta.url), "utf8");
  assert.equal(container.includes("GTM-WJ6GFSH4"), true);
  assert.equal(container.includes("G-490EC1PJXG"), true);
  assert.equal(container.includes("payment_authorized"), true);
  assert.equal(container.includes("1680735000138584"), false);
  assert.equal(container.includes("email"), false);
  assert.equal(container.includes("phone"), false);
});

test("delivery and repeated events stay tied to a successful result", () => {
  assert.equal(deliveryEvent({ tracked: "delivered", status: "delivered", isTest: false }), null);
  assert.equal(deliveryEvent({ tracked: "confirmed", status: "completed", isTest: false }), null);
  assert.deepEqual(deliveryEvent({ tracked: "delivered", status: "completed", isTest: false }), {
    event: "delivery_completed",
  });
  assert.equal(deliveryEvent({ tracked: "delivered", status: "completed", isTest: true }), null);
  const seen = new Set<string>();
  assert.equal(claimEvent(seen, "offer_received:1"), true);
  assert.equal(claimEvent(seen, "offer_received:1"), false);
});

test("a new account is recent and a notification maps without its text", () => {
  const now = Date.parse("2026-10-26T21:00:00.000Z");
  assert.equal(isFreshAccount("2026-10-26T20:59:00.000Z", now), true);
  assert.equal(isFreshAccount("2026-10-26T20:00:00.000Z", now), false);
  assert.deepEqual(
    newOfferIds([
      { offer_id: "11111111-1111-4111-8111-111111111111", viewed: false },
      { offer_id: "22222222-2222-4222-8222-222222222222", viewed: true },
    ]),
    ["11111111-1111-4111-8111-111111111111"],
  );
  assert.deepEqual(analyticsCookieNames("_ga=1; sb-auth=2; _fbp=3; pickuply.mode=customer"), ["_ga", "_fbp"]);
  assert.equal(notificationEvent("offer"), "offer_received");
  assert.equal(notificationEvent("assigned"), "driver_offer_accepted");
  assert.equal(notificationEvent("new_message"), null);
});
