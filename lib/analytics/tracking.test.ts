import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingEvent,
  claimEvent,
  containerId,
  deliveryEvent,
  isFreshAccount,
  nextPageView,
  notificationEvent,
  purchaseEvent,
  sanitizeFields,
  shouldLoadTagManager,
} from "./tracking";

test("the tag manager container id is the only script id", () => {
  assert.equal(containerId(), "GTM-WJ6GFSH4");
  assert.equal(containerId("G-490EC1PJXG"), null);
  assert.equal(containerId("1680735000138584"), null);
});

test("tag manager loads once after consent and stays off for a test account", () => {
  assert.equal(shouldLoadTagManager({ consent: null, isTest: false, loaded: false }), false);
  assert.equal(shouldLoadTagManager({ consent: "denied", isTest: false, loaded: false }), false);
  assert.equal(shouldLoadTagManager({ consent: "granted", isTest: true, loaded: false }), false);
  assert.equal(shouldLoadTagManager({ consent: "granted", isTest: false, loaded: false }), true);
  assert.equal(shouldLoadTagManager({ consent: "granted", isTest: false, loaded: true }), false);
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

test("booking is the card hold and purchase is a live captured charge", () => {
  assert.deepEqual(bookingEvent({ returning: true, paymentStatus: "authorized", isTest: false }), {
    event: "booking_confirmed",
  });
  assert.equal(bookingEvent({ returning: true, paymentStatus: "awaiting_payment", isTest: false }), null);
  assert.equal(bookingEvent({ returning: true, paymentStatus: "authorized", isTest: true }), null);
  assert.equal(
    purchaseEvent({
      tracked: "delivered",
      paymentStatus: "authorized",
      capturedCents: 5000,
      live: true,
      isTest: false,
    }),
    null,
  );
  assert.equal(
    purchaseEvent({
      tracked: "delivered",
      paymentStatus: "captured",
      capturedCents: 5000,
      live: false,
      isTest: false,
    }),
    null,
  );
  assert.equal(
    purchaseEvent({
      tracked: "delivered",
      paymentStatus: "captured",
      capturedCents: 5000,
      live: true,
      isTest: true,
    }),
    null,
  );
  assert.deepEqual(
    purchaseEvent({
      tracked: "delivered",
      paymentStatus: "captured",
      capturedCents: 5030,
      live: true,
      isTest: false,
    }),
    { event: "purchase", value: 50.3, currency: "USD" },
  );
});

test("delivery and repeated events stay tied to a successful result", () => {
  assert.equal(deliveryEvent({ tracked: "delivered", status: "delivered", isTest: false }), null);
  assert.deepEqual(deliveryEvent({ tracked: "confirmed", status: "completed", isTest: false }), {
    event: "delivery_completed",
  });
  assert.equal(deliveryEvent({ tracked: "confirmed", status: "completed", isTest: true }), null);
  const seen = new Set<string>();
  assert.equal(claimEvent(seen, "offer_received:1"), true);
  assert.equal(claimEvent(seen, "offer_received:1"), false);
});

test("a new account is recent and a notification maps without its text", () => {
  const now = Date.parse("2026-10-26T21:00:00.000Z");
  assert.equal(isFreshAccount("2026-10-26T20:59:00.000Z", now), true);
  assert.equal(isFreshAccount("2026-10-26T20:00:00.000Z", now), false);
  assert.equal(notificationEvent("offer"), "offer_received");
  assert.equal(notificationEvent("assigned"), "driver_offer_accepted");
  assert.equal(notificationEvent("new_message"), null);
});
