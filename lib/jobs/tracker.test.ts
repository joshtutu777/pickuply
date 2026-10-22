import assert from "node:assert/strict";
import test from "node:test";
import { buildJobTracker, nextDriverAction } from "./tracker";

const created = "2026-10-22T15:00:00.000Z";

test("quote job marks price confirmed when it opens", () => {
  const tracker = buildJobTracker({
    service: "delivery",
    status: "open",
    pricingMethod: "quote",
    paymentStatus: null,
    createdAt: created,
    dumpFeeCents: 0,
    hasDumpReceipt: false,
    events: [
      { type: "status", createdAt: created, toStatus: "requested" },
      { type: "quote_accepted", createdAt: "2026-10-22T16:00:00.000Z", toStatus: null },
      { type: "status", createdAt: "2026-10-22T16:00:01.000Z", toStatus: "open" },
    ],
  });
  const price = tracker.steps.find((step) => step.id === "price");
  const driver = tracker.steps.find((step) => step.id === "driver");
  assert.equal(price?.state, "done");
  assert.equal(driver?.state, "current");
  assert.equal(tracker.banner, null);
});

test("junk job uses haul labels and shows a receipt step when a dump fee exists", () => {
  const tracker = buildJobTracker({
    service: "junk",
    status: "delivered",
    pricingMethod: "fixed",
    paymentStatus: "authorized",
    createdAt: created,
    dumpFeeCents: 4500,
    hasDumpReceipt: false,
    events: [
      { type: "offer_chosen", createdAt: "2026-10-22T16:00:00.000Z", toStatus: null },
      { type: "status", createdAt: "2026-10-22T16:00:01.000Z", toStatus: "assigned" },
      { type: "status", createdAt: "2026-10-22T17:00:00.000Z", toStatus: "delivered" },
    ],
  });
  assert.equal(tracker.steps.find((step) => step.id === "picked_up")?.label, "Load picked up");
  assert.equal(tracker.steps.find((step) => step.id === "delivered")?.label, "Hauled away");
  assert.equal(tracker.steps.find((step) => step.id === "receipt")?.state, "current");
});

test("cancelled and disputed jobs are called out", () => {
  const cancelled = buildJobTracker({
    service: "delivery",
    status: "cancelled",
    pricingMethod: "quote",
    paymentStatus: "awaiting_payment",
    createdAt: created,
    dumpFeeCents: null,
    hasDumpReceipt: false,
    events: [],
  });
  const disputed = buildJobTracker({
    ...{
      service: "delivery",
      status: "disputed",
      pricingMethod: "quote",
      paymentStatus: "authorized",
      createdAt: created,
      dumpFeeCents: null,
      hasDumpReceipt: false,
      events: [{ type: "reassigned", createdAt: "2026-10-22T18:00:00.000Z", toStatus: null }],
    },
  });
  assert.equal(cancelled.banner, "Cancelled");
  assert.equal(disputed.banner, "Disputed");
});

test("the next driver button waits for payment and for the item check", () => {
  assert.equal(
    nextDriverAction({ status: "assigned", paymentStatus: "awaiting_payment", service: "delivery" }).waiting,
    "Waiting for payment",
  );
  assert.equal(
    nextDriverAction({ status: "assigned", paymentStatus: "authorized", service: "delivery" }).nextStatus,
    "en_route",
  );
  assert.equal(
    nextDriverAction({ status: "item_check", paymentStatus: "authorized", service: "junk" }).waiting,
    "Waiting for the customer to approve the item",
  );
});
