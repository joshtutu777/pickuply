import assert from "node:assert/strict";
import test from "node:test";
import { roleBadgeForHome } from "./role-badge";

test("the badge follows the active account", () => {
  assert.equal(roleBadgeForHome("/driver"), "DRIVER");
  assert.equal(roleBadgeForHome("/account"), "CUSTOMER");
  assert.equal(roleBadgeForHome("/admin"), "ADMIN");
  assert.equal(roleBadgeForHome("/login"), null);
});
