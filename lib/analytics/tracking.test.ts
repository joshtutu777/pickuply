import assert from "node:assert/strict";
import test from "node:test";
import {
  analyticsCookieNames,
  claimEvent,
  consentState,
  containerId,
  purchaseForBookingHold,
  sanitizeFields,
  shouldLoadTagManager,
  storedConsent,
  tipPurchaseEvent,
} from "./tracking";

test("the published container id is the only script id", () => {
  assert.equal(containerId(), "GTM-WJ6GFSH4");
  assert.equal(containerId("G-490EC1PJXG"), null);
  assert.equal(containerId("1680735000138584"), null);
});

test("a saved cookie choice is restored and tag manager waits for allow", () => {
  assert.equal(storedConsent("granted"), "granted");
  assert.equal(storedConsent("denied"), "denied");
  assert.equal(storedConsent(null), null);
  assert.equal(storedConsent("yes"), null);
  assert.equal(shouldLoadTagManager({ consent: null, isTest: false, loaded: false }), false);
  assert.equal(shouldLoadTagManager({ consent: "denied", isTest: false, loaded: false }), false);
  assert.equal(shouldLoadTagManager({ consent: "granted", isTest: true, loaded: false }), false);
  assert.equal(shouldLoadTagManager({ consent: "granted", isTest: false, loaded: false }), true);
  assert.equal(shouldLoadTagManager({ consent: "granted", isTest: false, loaded: true }), false);
});

test("allow turns analytics and advertising on, and reject turns both off", () => {
  assert.equal(consentState("granted").analytics_storage, "granted");
  assert.equal(consentState("granted").ad_storage, "granted");
  assert.equal(consentState("denied").analytics_storage, "denied");
  assert.equal(consentState("denied").ad_storage, "denied");
  assert.equal(consentState("denied").ad_user_data, "denied");
  assert.equal(consentState("denied").ad_personalization, "denied");
});

test("personal fields and card data stay out of events", () => {
  assert.deepEqual(
    sanitizeFields({
      service: "delivery",
      email: "a@example.com",
      phone: "5555550100",
      address: "1 Main St",
      name: "Ada",
      card: "4242",
      payment_method: "pm_card",
    }),
    { service: "delivery" },
  );
  assert.deepEqual(analyticsCookieNames("_ga=1; session=abc; _fbp=2; _ga_ABC=3"), ["_ga", "_fbp", "_ga_ABC"]);
});

test("a card hold is not a purchase and a tip purchase is counted once", () => {
  assert.equal(purchaseForBookingHold(), null);
  const tipId = "22222222-2222-4222-8222-222222222222";
  const purchase = tipPurchaseEvent({ tipId, amountCents: 500, paid: true, isTest: false });
  assert.deepEqual(purchase, { event: "purchase", transaction_id: tipId, value: 5, currency: "USD" });
  assert.equal(tipPurchaseEvent({ tipId, amountCents: 500, paid: false, isTest: false }), null);
  assert.equal(tipPurchaseEvent({ tipId, amountCents: 500, paid: true, isTest: true }), null);
  const seen = new Set<string>();
  assert.equal(claimEvent(seen, `purchase:${tipId}`), true);
  assert.equal(claimEvent(seen, `purchase:${tipId}`), false);
});
