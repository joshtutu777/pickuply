import assert from "node:assert/strict";
import test from "node:test";
import { parseSupportRequest, supportTopicLabel } from "./ticket";

const valid = {
  firstName: "Robin",
  lastName: "",
  email: "robin@example.com",
  topic: "payments",
  message: "The card hold is still showing.",
  jobReference: "",
  honeypot: "",
};

test("a support message needs a name, email, topic, and message", () => {
  assert.equal(parseSupportRequest({ ...valid, firstName: " " }).ok, false);
  assert.equal(parseSupportRequest({ ...valid, email: "not-an-email" }).ok, false);
  assert.equal(parseSupportRequest({ ...valid, topic: "secret" }).ok, false);
  assert.equal(parseSupportRequest(valid).ok, true);
});

test("a filled honeypot is rejected", () => {
  assert.equal(parseSupportRequest({ ...valid, honeypot: "http://spam" }).ok, false);
});

test("topic labels stay plain", () => {
  assert.equal(supportTopicLabel("pickup-delivery"), "Pickup or delivery");
});
