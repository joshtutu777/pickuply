import assert from "node:assert/strict";
import test from "node:test";
import { firstName, validateFullName } from "./name";

test("accepts a normal full name", () => {
  assert.equal(validateFullName("Mary-Jane O'Brien Jr."), "Mary-Jane O'Brien Jr.");
  assert.equal(validateFullName("  José  "), "José");
  assert.equal(validateFullName("A"), "A");
  assert.equal(validateFullName(`${"A".repeat(80)}`), "A".repeat(80));
  assert.equal(validateFullName("O\u2019Brien"), "O\u2019Brien");
});

test("rejects empty, long, and other characters", () => {
  assert.equal(validateFullName(""), null);
  assert.equal(validateFullName("   "), null);
  assert.equal(validateFullName("A".repeat(81)), null);
  assert.equal(validateFullName("John3"), null);
  assert.equal(validateFullName("John_Doe"), null);
  assert.equal(validateFullName("John@Doe"), null);
  assert.equal(validateFullName("Jane\nDoe"), null);
  assert.equal(validateFullName("..."), null);
  assert.equal(validateFullName("-"), null);
});

test("first name is the first word, and a blank name is omitted", () => {
  assert.equal(firstName("Mary Jane"), "Mary");
  assert.equal(firstName("  Mary-Jane O'Brien "), "Mary-Jane");
  assert.equal(firstName(""), null);
  assert.equal(firstName("   "), null);
  assert.equal(firstName(null), null);
});
