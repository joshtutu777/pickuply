import assert from "node:assert/strict";
import test from "node:test";
import { formatUsDay, formatUsWhen } from "./when";

test("timestamps display as a US date in the Georgia zone", () => {
  assert.equal(formatUsWhen("2026-10-27T18:30:00.000Z"), "Tue, Oct 27 · 2:30 PM");
  assert.equal(formatUsDay("2026-10-27"), "Tue, Oct 27");
  assert.equal(formatUsDay("asap"), "asap");
});
