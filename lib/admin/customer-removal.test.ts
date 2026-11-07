import assert from "node:assert/strict";
import test from "node:test";
import { customerRemovalMessage } from "./customer-removal";

test("removal messages explain the blocked records", () => {
  assert.match(customerRemovalMessage("removed"), /can register again/);
  assert.match(customerRemovalMessage("already_removed"), /already deleted/);
  assert.match(customerRemovalMessage("has_active_job"), /active request/);
  assert.match(customerRemovalMessage("has_jobs"), /request history/);
  assert.match(customerRemovalMessage("has_payment"), /payment history/);
  assert.match(customerRemovalMessage("has_dispute"), /dispute/);
  assert.match(customerRemovalMessage("not_customer"), /customer account/);
  assert.match(customerRemovalMessage("nope"), /could not be deleted/);
});
