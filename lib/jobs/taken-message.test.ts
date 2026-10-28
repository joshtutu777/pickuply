import assert from "node:assert/strict";
import test from "node:test";
import { takenJobMessage } from "./taken-message";

test("a rejected offer keeps the database reason in plain language", () => {
  assert.equal(takenJobMessage("job already taken"), "Sorry, another driver just took this job");
  assert.equal(takenJobMessage("offers are only allowed on open jobs"), "This request is no longer open.");
  assert.equal(takenJobMessage("this driver cannot offer on this job"), "This request is no longer available to you.");
  assert.equal(takenJobMessage("go online before sending an offer"), "go online before sending an offer");
  assert.equal(takenJobMessage("That pickup time has passed. Choose another offer."), "That pickup time has passed. Choose another offer.");
});
