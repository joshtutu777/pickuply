import assert from "node:assert/strict";
import test from "node:test";
import { checkoutLines } from "./checkout-lines";

test("checkout lists the offer and the card processing fee as separate lines", () => {
  const lines = checkoutLines(5_175, 5_000, 175);
  assert.deepEqual(
    lines.map((item) => [item.price_data.product_data.name, item.price_data.unit_amount]),
    [
      ["Pickuply offer", 5_000],
      ["Card processing fee", 175],
    ],
  );
  assert.equal(
    lines.reduce((sum, item) => sum + item.price_data.unit_amount, 0),
    5_175,
  );
});

test("a stored total that does not match the split is charged as one line", () => {
  const lines = checkoutLines(7_240, 6_000, 240);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.price_data.product_data.name, "Pickuply job");
  assert.equal(lines[0]?.price_data.unit_amount, 7_240);
});
