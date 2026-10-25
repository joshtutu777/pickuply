import assert from "node:assert/strict";
import test from "node:test";
import { acceptFixedPrice, offerBreakdown } from "./fees";

test("$50 offer keeps $7.50 and pays the driver $42.50", () => {
  const price = offerBreakdown(5_000);
  assert.equal(price.platformFeeCents, 750);
  assert.equal(price.driverEarningsCents, 4_250);
  assert.equal(price.subtotalCents, 5_000);
  assert.equal(price.driverEarningsCents + price.platformFeeCents, price.subtotalCents);
  assert.equal(price.customerTotalCents, price.subtotalCents + price.serviceFeeCents);
});

test("$100 offer keeps $15 and pays the driver $85", () => {
  const price = offerBreakdown(10_000);
  assert.equal(price.platformFeeCents, 1_500);
  assert.equal(price.driverEarningsCents, 8_500);
});

test("$200 offer keeps $30 and pays the driver $170", () => {
  const price = offerBreakdown(20_000);
  assert.equal(price.platformFeeCents, 3_000);
  assert.equal(price.driverEarningsCents, 17_000);
});

test("an odd-cent offer rounds driver earnings half up and gives the remainder to Pickuply", () => {
  const price = offerBreakdown(5_001);
  assert.equal(price.driverEarningsCents, 4_251);
  assert.equal(price.platformFeeCents, 750);
  assert.equal(price.driverEarningsCents + price.platformFeeCents, 5_001);
});

test("the customer is not charged the commission a second time", () => {
  const price = offerBreakdown(5_000);
  assert.equal(price.customerTotalCents - price.subtotalCents, price.serviceFeeCents);
  assert.ok(price.serviceFeeCents > 0);
  assert.equal(price.customerTotalCents, price.subtotalCents + price.serviceFeeCents);
});

test("a posted accept uses the same offer split", () => {
  assert.deepEqual(acceptFixedPrice(5_000), offerBreakdown(5_000));
});

test("one cent cannot pay the driver when the commission rounds the share to zero", () => {
  assert.throws(() => offerBreakdown(1, {
    platformBps: 9_999,
    platformMinCents: 0,
    serviceBps: 290,
    serviceFixedCents: 30,
  }), /driver earnings would be zero/);
});
