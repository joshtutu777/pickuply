import assert from "node:assert/strict";
import test from "node:test";
import { isWithinBookingWindow } from "../dates";
import { lateCancelSplit, tripFeeSplit } from "./fee-split";

test("a pickup can be at most 6 days ahead", () => {
  assert.equal(isWithinBookingWindow("2026-10-30", "2026-10-24"), true);
  assert.equal(isWithinBookingWindow("2026-10-31", "2026-10-24"), false);
});

test("the late-cancel and trip fees are turned off", () => {
  assert.deepEqual(lateCancelSplit(false), { totalCents: 0, driverCents: 0, platformCents: 0 });
  assert.deepEqual(lateCancelSplit(true), { totalCents: 0, driverCents: 0, platformCents: 0 });
  assert.deepEqual(tripFeeSplit(), { totalCents: 0, driverCents: 0, platformCents: 0 });
});

test("a configured late-cancel fee is still one $15 capture", () => {
  assert.deepEqual(lateCancelSplit(false, 1500), { totalCents: 1500, driverCents: 0, platformCents: 1500 });
  assert.deepEqual(lateCancelSplit(true, 1500), { totalCents: 1500, driverCents: 1000, platformCents: 500 });
});

test("a configured trip fee is still $20 to the driver and $5 to Pickuply", () => {
  assert.deepEqual(tripFeeSplit(2500), { totalCents: 2500, driverCents: 2000, platformCents: 500 });
});
