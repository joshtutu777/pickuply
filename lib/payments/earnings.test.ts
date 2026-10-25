import assert from "node:assert/strict";
import test from "node:test";
import { driverEarningCents, earningsAvailability } from "./earnings";

test("a completed job earns the driver pay and not the dump estimate", () => {
  assert.equal(
    driverEarningCents({
      completed: true,
      driverPayCents: 8000,
      tripFeeCents: null,
      dumpFeeCents: 4500,
    }),
    8000,
  );
});

test("a rejected pickup earns the trip fee and not the dump estimate", () => {
  assert.equal(
    driverEarningCents({
      completed: false,
      driverPayCents: 8000,
      tripFeeCents: 2500,
      dumpFeeCents: 4500,
    }),
    2500,
  );
});

test("held earnings say payout setup is required", () => {
  const held = earningsAvailability("held_until_onboarding");
  assert.equal(held.label, "Held");
  assert.match(held.detail, /not an immediate payout/);
  assert.equal(earningsAvailability("pending").label, "Pending");
  assert.equal(earningsAvailability("ready").label, "Available");
});
