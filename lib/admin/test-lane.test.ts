import assert from "node:assert/strict";
import test from "node:test";
import { inTestLane, includeTestParam, laneFromViewer } from "./test-lane";

test("include test data is off unless the query asks for it", () => {
  assert.equal(includeTestParam(undefined), false);
  assert.equal(includeTestParam("0"), false);
  assert.equal(includeTestParam("1"), true);
  assert.equal(includeTestParam(["1"]), true);
});

test("a test admin cannot widen the lane to real accounts", () => {
  assert.equal(laneFromViewer(true, true), "test");
  assert.equal(laneFromViewer(false, false), "real");
  assert.equal(laneFromViewer(false, true), "all");
  assert.equal(inTestLane(true, "real"), false);
  assert.equal(inTestLane(false, "test"), false);
  assert.equal(inTestLane(true, "all"), true);
});
