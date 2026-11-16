import assert from "node:assert/strict";
import test from "node:test";
import { isWithinBookingWindow } from "../dates";
import { lateCancelSplit, tripFeeSplit } from "./fee-split";

test("a pickup can be at most 6 days ahead", () => {
  assert.equal(isWithinBookingWindow("2026-10-30", "2026-10-24"), true);
  assert.equal(isWithinBookingWindow("2026-10-31", "2026-10-24"), false);
});

test("a late cancel does not create a charge during launch", () => {
  assert.deepEqual(lateCancelSplit(false), { totalCents: 0, driverCents: 0, platformCents: 0 });
  assert.deepEqual(lateCancelSplit(true), { totalCents: 0, driverCents: 0, platformCents: 0 });
});

test("a rejected item does not create a trip fee during launch", () => {
  assert.deepEqual(tripFeeSplit(), { totalCents: 0, driverCents: 0, platformCents: 0 });
});
