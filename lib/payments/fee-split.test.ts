import assert from "node:assert/strict";
import test from "node:test";
import { isWithinBookingWindow } from "../dates";
import { lateCancelSplit, tripFeeSplit } from "./fee-split";

test("a pickup can be at most 6 days ahead", () => {
  assert.equal(isWithinBookingWindow("2026-10-30", "2026-10-24"), true);
  assert.equal(isWithinBookingWindow("2026-10-31", "2026-10-24"), false);
});

test("the late-cancel fee is one $15 capture", () => {
  assert.deepEqual(lateCancelSplit(false), { totalCents: 1500, driverCents: 0, platformCents: 1500 });
  assert.deepEqual(lateCancelSplit(true), { totalCents: 1500, driverCents: 1000, platformCents: 500 });
});

test("the trip fee is $20 to the driver and $5 to Pickuply", () => {
  assert.deepEqual(tripFeeSplit(), { totalCents: 2500, driverCents: 2000, platformCents: 500 });
});
