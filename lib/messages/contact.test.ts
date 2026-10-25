import assert from "node:assert/strict";
import test from "node:test";
import { containsContact } from "./contact";

test("a phone number or email is caught before a message is sent", () => {
  assert.equal(containsContact("I'm outside"), false);
  assert.equal(containsContact("call me at 404-555-0100"), true);
  assert.equal(containsContact("text 4045550100"), true);
  assert.equal(containsContact("write me at pat@example.com"), true);
});
