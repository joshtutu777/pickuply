import assert from "node:assert/strict";
import test from "node:test";
import { roundHalfMile, tripLabel } from "./miles";

test("half miles round to the nearest 0.5", () => {
  assert.equal(roundHalfMile(12.2), 12);
  assert.equal(roundHalfMile(12.3), 12.5);
  assert.equal(roundHalfMile(12.5), 12.5);
});

test("a missing trip is a dash, never a guess", () => {
  assert.equal(tripLabel(null, null), "—");
  assert.equal(tripLabel(10, "driving"), "10 driving miles");
  assert.equal(tripLabel(10, "straight"), "10 straight-line miles");
});
