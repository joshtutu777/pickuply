import assert from "node:assert/strict";
import test from "node:test";
import { codeSentMessage, maskUsPhone, normalizeUsPhone } from "./phone";

const phone = "+15555550100";

test("normalizes US numbers to +1 and ten digits", () => {
  assert.equal(normalizeUsPhone("5555550100"), phone);
  assert.equal(normalizeUsPhone("(555) 555-0100"), phone);
  assert.equal(normalizeUsPhone("1-555-555-0100"), phone);
  assert.equal(normalizeUsPhone("+1 555 555 0100"), phone);
  assert.equal(normalizeUsPhone("555-0100"), null);
  assert.equal(normalizeUsPhone("+44 20 7946 0958"), null);
  assert.equal(normalizeUsPhone(""), null);
  assert.equal(normalizeUsPhone("not a phone"), null);
});

test("masks every digit except the last four", () => {
  const mask = maskUsPhone("(555) 555-0100");
  assert.equal(mask, "(•••) •••-0100");
  assert.equal(mask?.includes("555555"), false);
  assert.equal(codeSentMessage(phone), "Enter the 6-digit code for (•••) •••-0100.");
  assert.equal(codeSentMessage("123"), null);
  assert.equal(maskUsPhone("123"), null);
});
