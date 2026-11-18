import assert from "node:assert/strict";
import test from "node:test";
import { matchesRecipientQuery } from "./search";

const sam = { name: "Sam Randolph", phone: "+14045550188", role: "driver" };
const casey = { name: "Casey Nguyen", phone: "(770) 555-0144", role: "customer" };

test("name search matches a first name, last name, and either order", () => {
  assert.equal(matchesRecipientQuery("Sam", sam), true);
  assert.equal(matchesRecipientQuery("randolph", sam), true);
  assert.equal(matchesRecipientQuery("Sam Randolph", sam), true);
  assert.equal(matchesRecipientQuery("Randolph Sam", sam), true);
  assert.equal(matchesRecipientQuery("Sa", casey), false);
  assert.equal(matchesRecipientQuery("S", sam), false);
});

test("phone search matches the digits an admin types", () => {
  assert.equal(matchesRecipientQuery("4045550188", sam), true);
  assert.equal(matchesRecipientQuery("(404) 555-0188", sam), true);
  assert.equal(matchesRecipientQuery("770555", casey), true);
  assert.equal(matchesRecipientQuery("999", sam), false);
});
