import assert from "node:assert/strict";
import test from "node:test";
import { acceptFixedPrice, forwardFromEarnings } from "./fees";

test("fixed accept $150 splits into the expected earnings, platform fee, and service fee", () => {
  assert.deepEqual(acceptFixedPrice(15_000), {
    driverEarningsCents: 13_214,
    platformFeeCents: 1_321,
    subtotalCents: 14_535,
    serviceFeeCents: 465,
    customerTotalCents: 15_000,
  });
});

test("fixed accept $35 keeps the posted total", () => {
  // 2.9% of 3500 cents is 101.5. Half-up rounding makes that 102 cents, plus 30 cents.
  // A service fee of 131 cents would not cover that rounded card charge.
  const price = acceptFixedPrice(3_500);
  assert.equal(price.customerTotalCents, 3_500);
  assert.deepEqual(price, {
    driverEarningsCents: 2_368,
    platformFeeCents: 1_000,
    subtotalCents: 3_368,
    serviceFeeCents: 132,
    customerTotalCents: 3_500,
  });
});

test("an offer of $60 driver earnings becomes a $72.40 customer total", () => {
  const price = forwardFromEarnings(6_000);
  assert.equal(price.customerTotalCents, 7_240);
  assert.equal(
    price.driverEarningsCents + price.platformFeeCents + price.serviceFeeCents,
    price.customerTotalCents,
  );
});

test("an offer of $120 driver earnings becomes a $136.25 customer total", () => {
  const price = forwardFromEarnings(12_000);
  assert.equal(price.customerTotalCents, 13_625);
  assert.equal(price.platformFeeCents, 1_200);
  assert.equal(
    price.driverEarningsCents + price.platformFeeCents + price.serviceFeeCents,
    price.customerTotalCents,
  );
});

test("fixed accept rejects a total that cannot pay the driver", () => {
  assert.throws(() => acceptFixedPrice(100), /driver earnings would be zero/);
});
