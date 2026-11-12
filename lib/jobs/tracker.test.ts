import assert from "node:assert/strict";
import test from "node:test";
import { buildJobTracker, customerProgress, nextDriverAction } from "./tracker";

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
  assert.equal(tracker.steps.find((step) => step.id === "picked_up"), undefined);
  assert.equal(tracker.steps.find((step) => step.id === "delivered")?.label, "Junk removed");
  assert.equal(tracker.steps.find((step) => step.id === "receipt")?.state, "current");

  const flagged = buildJobTracker({
    service: "junk",
    status: "delivered",
    pricingMethod: "fixed",
    paymentStatus: "authorized",
    createdAt: created,
    dumpFeeCents: 0,
    requireDisposalReceipt: true,
    hasDumpReceipt: false,
    events: [],
  });
  assert.ok(flagged.steps.some((step) => step.id === "receipt"));

  const haulOnly = buildJobTracker({
    service: "junk",
    status: "delivered",
    pricingMethod: "fixed",
    paymentStatus: "authorized",
    createdAt: created,
    dumpFeeCents: 0,
    hasDumpReceipt: false,
    events: [],
  });
  assert.equal(haulOnly.steps.some((step) => step.id === "receipt"), false);
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

test("an assigned job says awaiting payment until the card is authorized", () => {
  const events = [
    { type: "offer_chosen", createdAt: "2026-10-22T16:00:00.000Z", toStatus: null },
    { type: "status", createdAt: "2026-10-22T16:00:01.000Z", toStatus: "assigned" },
  ];
  const unpaid = buildJobTracker({
    service: "delivery",
    status: "assigned",
    pricingMethod: "fixed",
    paymentStatus: "awaiting_payment",
    createdAt: created,
    dumpFeeCents: null,
    hasDumpReceipt: false,
    events,
  });
  const payment = unpaid.steps.find((step) => step.id === "payment");
  assert.equal(payment?.state, "current");
  assert.equal(payment?.label, "Awaiting payment");
  assert.equal(unpaid.steps.some((step) => step.label === "Booking confirmed"), false);

  const authorized = buildJobTracker({
    service: "delivery",
    status: "assigned",
    pricingMethod: "fixed",
    paymentStatus: "authorized",
    createdAt: created,
    dumpFeeCents: null,
    hasDumpReceipt: false,
    events,
  });
  assert.equal(authorized.steps.find((step) => step.id === "payment")?.label, "Booking confirmed");
  assert.equal(authorized.steps.find((step) => step.id === "payment")?.state, "done");
});

test("customer tracking uses four milestones", () => {
  const requested = customerProgress({
    status: "requested",
    paymentStatus: null,
    service: "delivery",
    pricingMethod: "quote",
  });
  assert.deepEqual(
    requested.milestones.map((step) => step.state),
    ["current", "upcoming", "upcoming", "upcoming"],
  );
  assert.equal(requested.milestones[0]?.label, "Request & Price");
  assert.match(requested.next, /Drivers cannot see this yet/);

  const awaiting = customerProgress({
    status: "assigned",
    paymentStatus: "awaiting_payment",
    service: "delivery",
    pricingMethod: "fixed",
  });
  assert.equal(awaiting.milestones.find((step) => step.id === "driver")?.state, "current");
  assert.equal(awaiting.milestones.find((step) => step.id === "pickup")?.state, "upcoming");
  assert.match(awaiting.next, /card is held, not charged/);

  const failed = customerProgress({
    status: "assigned",
    paymentStatus: "failed",
    service: "delivery",
    pricingMethod: "fixed",
  });
  assert.equal(failed.milestones.find((step) => step.id === "driver")?.state, "current");

  const pickup = customerProgress({
    status: "en_route",
    paymentStatus: "authorized",
    service: "delivery",
    pricingMethod: "fixed",
  });
  assert.equal(pickup.milestones.find((step) => step.id === "driver")?.state, "done");
  assert.equal(pickup.milestones.find((step) => step.id === "pickup")?.state, "current");
  assert.equal(pickup.milestones.find((step) => step.id === "delivered")?.state, "upcoming");

  const paidAndAssigned = customerProgress({
    status: "assigned",
    paymentStatus: "authorized",
    service: "delivery",
    pricingMethod: "fixed",
  });
  assert.equal(paidAndAssigned.milestones.find((step) => step.id === "driver")?.state, "current");
  assert.equal(paidAndAssigned.milestones.find((step) => step.id === "pickup")?.state, "upcoming");
  assert.equal(paidAndAssigned.action, null);
  assert.equal(awaiting.action, "Add card");

  const completed = customerProgress({
    status: "completed",
    paymentStatus: "captured",
    service: "junk",
    pricingMethod: "quote",
  });
  assert.equal(completed.milestones.every((step) => step.state === "done"), true);
  assert.equal(completed.next, "This request is finished.");
});

test("the next driver button waits for payment and then continues by service", () => {
  assert.equal(
    nextDriverAction({ status: "assigned", paymentStatus: "awaiting_payment", service: "delivery" }).waiting,
    "Waiting for customer to add card",
  );
  assert.equal(
    nextDriverAction({ status: "assigned", paymentStatus: "authorized", service: "delivery" }).nextStatus,
    "en_route",
  );
  assert.equal(
    nextDriverAction({ status: "item_check", paymentStatus: "authorized", service: "delivery" }).nextStatus,
    "in_transit",
  );
  assert.equal(
    nextDriverAction({ status: "arrived", paymentStatus: "authorized", service: "junk" }).label,
    "Junk removed",
  );
});
