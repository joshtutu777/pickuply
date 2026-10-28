import assert from "node:assert/strict";
import test from "node:test";
import { checkoutCustomerEmail, checkoutExcludedPaymentMethods, checkoutLines } from "./checkout-lines";

test("checkout lists the offer and the service fee as separate lines", () => {
  const lines = checkoutLines(10_500, 10_000, 500);
  assert.deepEqual(
    lines.map((item) => [item.price_data.product_data.name, item.price_data.unit_amount]),
    [
      ["Pickup service", 10_000],
      ["Service fee", 500],
    ],
  );
  assert.equal(
    lines.reduce((sum, item) => sum + item.price_data.unit_amount, 0),
    10_500,
  );
});

test("checkout gets a saved email and still starts when the profile has none", () => {
  assert.equal(checkoutCustomerEmail("  ada@example.com  "), "ada@example.com");
  assert.equal(checkoutCustomerEmail(""), undefined);
  assert.equal(checkoutCustomerEmail(null), undefined);
  assert.equal(checkoutCustomerEmail("   "), undefined);
});

test("checkout excludes bank, Klarna, and the other non-card methods", () => {
  const excluded = new Set<string>(checkoutExcludedPaymentMethods);
  assert.equal(excluded.has("card"), false);
  assert.equal(excluded.has("link"), false);
  assert.equal(excluded.has("klarna"), true);
  assert.equal(excluded.has("us_bank_account"), true);
  assert.equal(excluded.has("pay_by_bank"), true);
});

test("a stored total that does not match the split is charged as one line", () => {
  const lines = checkoutLines(7_240, 6_000, 240);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.price_data.product_data.name, "Pickuply job");
  assert.equal(lines[0]?.price_data.unit_amount, 7_240);
});
