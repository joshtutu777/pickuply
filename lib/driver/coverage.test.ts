import assert from "node:assert/strict";
import test from "node:test";
import { coverageSummary } from "./coverage";

test("coverage summary lists cities and the radius", () => {
  assert.equal(
    coverageSummary({ cities: ["Austell", "Smyrna"], zips: [], radiusMiles: 25 }),
    "Austell, Smyrna +25 mi",
  );
  assert.equal(coverageSummary({ cities: [], zips: [], radiusMiles: 25 }), "Within 25 mi");
});
