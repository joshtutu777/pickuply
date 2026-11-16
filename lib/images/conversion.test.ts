import assert from "node:assert/strict";
import test from "node:test";
import { photoConversionEnabled } from "./conversion";

test("photo conversion stays off unless the server switch is exactly on", () => {
  assert.equal(photoConversionEnabled(undefined), false);
  assert.equal(photoConversionEnabled(""), false);
  assert.equal(photoConversionEnabled("off"), false);
  assert.equal(photoConversionEnabled("ON"), false);
  assert.equal(photoConversionEnabled("on"), true);
});
