import assert from "node:assert/strict";
import test from "node:test";
import { customerCardAction, customerJobTab, customerListStatus } from "./customer-tabs";

const statuses = [
  "requested",
  "in_review",
  "quoted",
  "open",
  "assigned",
  "en_route",
  "arrived",
  "item_check",
  "in_transit",
  "delivered",
  "completed",
  "cancelled",
  "disputed",
  "expired",
];

test("every persisted status lands in exactly one customer tab", () => {
  const seen = new Map<string, string>();
  for (const status of statuses) {
    const tab = customerJobTab({ status });
    assert.equal(seen.has(`${status}:open`), false);
    seen.set(status, tab);
  }
  assert.deepEqual(
    statuses.filter((status) => customerJobTab({ status }) === "requests"),
    ["requested", "in_review", "quoted", "open"],
  );
  assert.deepEqual(
    statuses.filter((status) => customerJobTab({ status }) === "active"),
    ["assigned", "en_route", "arrived", "item_check", "in_transit", "delivered", "disputed"],
  );
  assert.deepEqual(
    statuses.filter((status) => customerJobTab({ status }) === "history"),
    ["completed", "cancelled", "expired"],
  );
  assert.equal(customerJobTab({ status: "open", retired: true }), "history");
  assert.equal(customerJobTab({ status: "assigned", retired: true }), "history");
  assert.equal(customerJobTab({ status: "disputed" }), "active");
});

test("list copy does not claim drivers were notified", () => {
  assert.equal(customerListStatus({ status: "open", pricingMethod: "fixed", activeOffers: 0 }), "No offers yet");
  assert.equal(customerListStatus({ status: "open", pricingMethod: "range", activeOffers: 2 }), "Offers Received");
  assert.equal(
    customerListStatus({ status: "requested", pricingMethod: "quote", activeOffers: 0 }),
    "Preparing your price",
  );
  assert.equal(customerListStatus({ status: "quoted", pricingMethod: "quote", activeOffers: 0 }), "Your price is ready");
  const text = [
    customerListStatus({ status: "requested", pricingMethod: "quote", activeOffers: 0 }),
    customerListStatus({ status: "open", pricingMethod: "quote", activeOffers: 0 }),
    customerListStatus({ status: "quoted", pricingMethod: "quote", activeOffers: 0 }),
  ].join(" ");
  assert.equal(text.toLowerCase().includes("notified"), false);
  assert.equal(customerCardAction({ status: "delivered", paymentStatus: "authorized", activeOffers: 0 }), "Review Delivery");
  assert.equal(
    customerCardAction({ status: "assigned", paymentStatus: "awaiting_payment", activeOffers: 0 }),
    "Confirm booking",
  );
  assert.equal(customerCardAction({ status: "en_route", paymentStatus: "authorized", activeOffers: 0 }), "Track Delivery");
});
