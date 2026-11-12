import assert from "node:assert/strict";
import test from "node:test";
import { tipAmountError, tipNotice, tipReceiptLines, tipSplit, tipWindowOpen } from "./tips";

test("no tip is the default and presets are optional amounts", () => {
  assert.equal(tipAmountError(null), null);
  assert.equal(tipAmountError(500), null);
  assert.equal(tipAmountError(1000), null);
  assert.equal(tipAmountError(2000), null);
  assert.equal(tipAmountError(100), null);
  assert.equal(tipAmountError(20_000), null);
  assert.match(tipAmountError(99) ?? "", /\$1 to \$200/);
  assert.match(tipAmountError(20_001) ?? "", /\$1 to \$200/);
});

test("a tip adds nothing for Pickuply and the whole amount for the driver", () => {
  const split = tipSplit(1000);
  assert.deepEqual(split, {
    driverCents: 1000,
    commissionCents: 0,
    serviceFeeCents: 0,
    customerCents: 1000,
  });
});

test("a $100 booking and a later $10 tip stay separate", () => {
  const lines = tipReceiptLines(10_500, 1000);
  assert.match(lines[0], /\$105\.00/);
  assert.match(lines[1], /\$10\.00/);
  assert.match(lines.join("\n"), /100%/);
});

test("the tip window closes seven days after completion", () => {
  const completed = "2026-10-01T12:00:00.000Z";
  const completedMs = new Date(completed).getTime();
  assert.equal(tipWindowOpen(completed, completedMs + 6 * 24 * 60 * 60 * 1000), true);
  assert.equal(tipWindowOpen(completed, completedMs + 8 * 24 * 60 * 60 * 1000), false);
  assert.equal(tipWindowOpen(null, completedMs), false);
});

test("the driver notice names the tip and the customer first name", () => {
  assert.equal(tipNotice(1000, "Sam Rivera"), "You got a $10 tip from Sam!");
});
