import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnPath } from "./safe-return-path";

test("accepts a single internal path", () => {
  assert.equal(safeReturnPath("/account"), "/account");
  assert.equal(safeReturnPath("/driver/onboarding"), "/driver/onboarding");
  assert.equal(safeReturnPath("/account?error=forbidden"), "/account?error=forbidden");
  assert.equal(safeReturnPath("/administrator"), "/administrator");
  assert.equal(safeReturnPath("/"), "/");
  assert.equal(safeReturnPath("  /login/name  "), "/login/name");
});

test("rejects missing values and off-site targets", () => {
  assert.equal(safeReturnPath(null), null);
  assert.equal(safeReturnPath(undefined), null);
  assert.equal(safeReturnPath(""), null);
  assert.equal(safeReturnPath("   "), null);
  assert.equal(safeReturnPath("account"), null);
  assert.equal(safeReturnPath("https://evil.example"), null);
  assert.equal(safeReturnPath("http://evil.example/account"), null);
  assert.equal(safeReturnPath("//evil.example"), null);
  assert.equal(safeReturnPath("///evil.example"), null);
  assert.equal(safeReturnPath("/\\evil.example"), null);
  assert.equal(safeReturnPath("/foo:bar"), null);
  assert.equal(safeReturnPath("/user@host"), null);
  assert.equal(safeReturnPath("/foo bar"), null);
  assert.equal(safeReturnPath("/login?next=https://evil.example"), null);
});

test("rejects encoded slashes, backslashes, and double encoding", () => {
  assert.equal(safeReturnPath("/%2F%2Fevil.example"), null);
  assert.equal(safeReturnPath("/%5Cevil.example"), null);
  assert.equal(safeReturnPath("/%252F%252Fevil.example"), null);
  assert.equal(safeReturnPath("/%252f%252fevil.example/account"), null);
  assert.equal(safeReturnPath("/%0A/login"), null);
  assert.equal(safeReturnPath("/%09/login"), null);
  assert.equal(safeReturnPath("/%40evil.example"), null);
  assert.equal(safeReturnPath("/login%3A%2F%2Fevil.example"), null);
});
