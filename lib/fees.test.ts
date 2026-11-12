import assert from "node:assert/strict";
import test from "node:test";
import { acceptFixedPrice, defaultFeeSettings, offerBreakdown, roundHalfUp, serviceFeeCents } from "./fees";

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

test("a $100 offer adds a $5 service fee and keeps the driver at 85 percent", () => {
  const price = offerBreakdown(10_000);
  assert.equal(price.serviceFeeCents, 500);
  assert.equal(price.customerTotalCents, 10_500);
  assert.equal(price.driverEarningsCents, 8_500);
  assert.equal(price.platformFeeCents, 1_500);
});

test("the service fee rounds half up and does not use a card rate", () => {
  assert.equal(serviceFeeCents(10), 1);
  assert.equal(roundHalfUp(10 * 500, 10_000), 1);
  assert.equal(serviceFeeCents(3), 0);
  const price = offerBreakdown(5_000);
  assert.equal(price.serviceFeeCents, 250);
  assert.equal(price.customerTotalCents, 5_250);
});

test("five hundred offer amounts match the half-up service fee", () => {
  for (let cents = 3_500; cents < 4_000; cents += 1) {
    const price = offerBreakdown(cents);
    assert.equal(price.serviceFeeCents, roundHalfUp(cents * 500, 10_000));
    assert.equal(price.customerTotalCents, cents + price.serviceFeeCents);
    assert.equal(price.driverEarningsCents, roundHalfUp(cents * 8_500, 10_000));
    assert.equal(price.driverEarningsCents + price.platformFeeCents, cents);
  }
});

test("a posted accept uses the same offer split", () => {
  assert.deepEqual(acceptFixedPrice(5_000), offerBreakdown(5_000));
});

test("a commission minimum does not change the split or add a fee", () => {
  const price = offerBreakdown(5_000, { ...defaultFeeSettings, platformMinCents: 1_000 });
  assert.deepEqual(price, offerBreakdown(5_000));
  assert.equal(price.platformFeeCents, 750);
  assert.equal(price.driverEarningsCents, 4_250);
});

test("one cent cannot pay the driver when the commission rounds the share to zero", () => {
  assert.throws(() => offerBreakdown(1, {
    platformBps: 9_999,
    platformMinCents: 0,
    serviceFeeBps: 500,
  }), /driver earnings would be zero/);
});
