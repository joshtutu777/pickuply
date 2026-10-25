import assert from "node:assert/strict";
import test from "node:test";
import { checkoutExpiresAt } from "./checkout-expiry";

const now = Date.parse("2026-10-22T18:00:00.000Z");

test("checkout lasts until the payment deadline when that is more than 30 minutes away", () => {
  const due = now + 2 * 60 * 60 * 1000;
  assert.equal(checkoutExpiresAt(due, now), Math.floor(due / 1000));
});

test("checkout uses Stripe's 30 minute minimum when the deadline is closer", () => {
  const due = now + 10 * 60 * 1000;
  assert.equal(checkoutExpiresAt(due, now), Math.floor(now / 1000) + 30 * 60 + 1);
});

test("checkout does not stay open longer than one day", () => {
  const due = now + 3 * 24 * 60 * 60 * 1000;
  assert.equal(checkoutExpiresAt(due, now), Math.floor((now + 24 * 60 * 60 * 1000) / 1000));
});
