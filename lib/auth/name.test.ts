import assert from "node:assert/strict";
import test from "node:test";
import { displayFullName, firstName, reliableNameParts, resolvedNames, validateFullName, validateNamePart } from "./name";

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

test("a name part accepts letters and rejects a missing or invented value", () => {
  assert.equal(validateNamePart("  José  "), "José");
  assert.equal(validateNamePart("Mary-Jane"), "Mary-Jane");
  assert.equal(validateNamePart("O\u2019Brien"), "O\u2019Brien");
  assert.equal(validateNamePart(""), null);
  assert.equal(validateNamePart("A".repeat(41)), null);
  assert.equal(validateNamePart("John3"), null);
});

test("only a two-word saved name fills both parts", () => {
  assert.deepEqual(reliableNameParts("Casey"), { firstName: "Casey", lastName: null });
  assert.deepEqual(reliableNameParts("Ada Lovelace"), { firstName: "Ada", lastName: "Lovelace" });
  assert.deepEqual(reliableNameParts("Mary Ann Smith"), { firstName: "Mary", lastName: null });
  assert.deepEqual(reliableNameParts("John3 Doe"), { firstName: null, lastName: null });
  assert.deepEqual(reliableNameParts("..."), { firstName: null, lastName: null });
});

test("display keeps a stored name when the last name is unknown", () => {
  assert.equal(displayFullName({ firstName: "Mary", lastName: null, fullName: "Mary Ann Smith" }), "Mary Ann Smith");
  assert.equal(displayFullName({ firstName: "Ada", lastName: "Lovelace", fullName: "Ada" }), "Ada Lovelace");
  assert.equal(displayFullName({ firstName: null, lastName: null, fullName: "Casey" }), "Casey");
  assert.equal(
    resolvedNames({ firstName: "Patricia", lastName: null, fullName: "Pat Lee" }).complete,
    false,
  );
  assert.equal(resolvedNames({ firstName: "Patricia", lastName: null, fullName: "Pat Lee" }).firstName, "Patricia");
  assert.equal(resolvedNames({ firstName: null, lastName: null, fullName: "Ada Lovelace" }).complete, true);
});

test("first name is the first word, and a blank name is omitted", () => {
  assert.equal(firstName("Mary Jane"), "Mary");
  assert.equal(firstName("  Mary-Jane O'Brien "), "Mary-Jane");
  assert.equal(firstName(""), null);
  assert.equal(firstName("   "), null);
  assert.equal(firstName(null), null);
});
