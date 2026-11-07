import assert from "node:assert/strict";
import test from "node:test";
import { homeAccount } from "./home-account";

test("a signed-out visitor sees sign-in", () => {
  assert.deepEqual(
    homeAccount({ signedIn: false, role: null, firstName: null, registrationComplete: false }),
    { kind: "signed-out" },
  );
});

test("a finished customer sees their first name and account", () => {
  assert.deepEqual(
    homeAccount({ signedIn: true, role: "customer", firstName: "Ada", registrationComplete: true }),
    { kind: "customer", firstName: "Ada" },
  );
});

test("an unfinished customer is asked to complete their profile", () => {
  assert.deepEqual(
    homeAccount({ signedIn: true, role: "customer", firstName: "Ada", registrationComplete: false }),
    { kind: "finish-profile", firstName: "Ada" },
  );
  assert.deepEqual(
    homeAccount({ signedIn: true, role: "customer", firstName: null, registrationComplete: false }),
    { kind: "finish-profile", firstName: null },
  );
});

test("a phone number is not used as the homepage name", () => {
  assert.deepEqual(
    homeAccount({ signedIn: true, role: "customer", firstName: "5551234567", registrationComplete: true }),
    { kind: "customer", firstName: null },
  );
});

test("drivers and admins keep their own homes", () => {
  assert.deepEqual(
    homeAccount({ signedIn: true, role: "driver", firstName: "Sam", registrationComplete: false }),
    { kind: "driver", firstName: "Sam" },
  );
  assert.deepEqual(
    homeAccount({ signedIn: true, role: "admin", firstName: "Pat", registrationComplete: true }),
    { kind: "admin", firstName: "Pat" },
  );
});
