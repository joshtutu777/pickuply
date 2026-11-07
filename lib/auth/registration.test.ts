import assert from "node:assert/strict";
import test from "node:test";
import { registrationFilter, registrationLabel } from "./registration";

test("the customer list defaults to finished registrations", () => {
  assert.equal(registrationFilter(undefined), "complete");
  assert.equal(registrationFilter("complete"), "complete");
  assert.equal(registrationFilter("nope"), "complete");
  assert.equal(registrationFilter("incomplete"), "incomplete");
  assert.equal(registrationFilter("all"), "all");
});

test("registration status follows the saved name", () => {
  assert.equal(registrationLabel({ completedAt: null, firstName: null, lastName: null, fullName: null }), "Phone verified");
  assert.equal(registrationLabel({ completedAt: null, firstName: "Ada", lastName: null, fullName: "Ada" }), "Name not finished");
  assert.equal(
    registrationLabel({ completedAt: null, firstName: "Mary", lastName: null, fullName: "Mary Ann Smith" }),
    "Name not finished",
  );
  assert.equal(
    registrationLabel({ completedAt: "2026-11-01T15:00:00.000Z", firstName: "Ada", lastName: "Lovelace", fullName: "Ada Lovelace" }),
    "Registered",
  );
  assert.equal(
    registrationLabel({ completedAt: null, firstName: "Ada", lastName: "Lovelace", fullName: "Ada Lovelace" }),
    "Registered",
  );
});
