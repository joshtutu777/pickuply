import assert from "node:assert/strict";
import test from "node:test";
import { cityFromArea, customerNextAction, pickCurrentJob, shortJobId } from "./next-action";

test("confirm booking only while payment is actually due", () => {
  assert.equal(
    customerNextAction({ status: "assigned", paymentStatus: "awaiting_payment", pricingMethod: "quote" }).label,
    "Confirm booking",
  );
  assert.equal(
    customerNextAction({ status: "assigned", paymentStatus: "authorized", pricingMethod: "quote" }).label,
    "View driver progress",
  );
  assert.equal(
    customerNextAction({ status: "quoted", paymentStatus: null, pricingMethod: "quote" }).label,
    "Review quote",
  );
  assert.equal(
    customerNextAction({ status: "open", paymentStatus: null, pricingMethod: "fixed" }).label,
    "Select an offer",
  );
  assert.equal(
    customerNextAction({ status: "open", paymentStatus: null, pricingMethod: "quote" }).label,
    "View request",
  );
});

test("the current job is the one that needs the customer first", () => {
  const current = pickCurrentJob([
    { status: "completed", updated_at: "2026-10-22T12:00:00Z" },
    { status: "requested", updated_at: "2026-10-22T13:00:00Z" },
    { status: "assigned", updated_at: "2026-10-22T11:00:00Z" },
  ]);
  assert.equal(current?.status, "assigned");
});

test("a short id and a city do not invent a place", () => {
  assert.equal(shortJobId("01770000-0000-4000-8000-000000000001"), "000001");
  assert.equal(cityFromArea("Austell, 30106"), "Austell");
  assert.equal(cityFromArea("30106"), null);
  assert.equal(cityFromArea(null), null);
});
