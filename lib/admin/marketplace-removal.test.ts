import assert from "node:assert/strict";
import test from "node:test";
import { marketplaceRemovalMessage } from "./marketplace-removal";

test("marketplace removal messages name the blocker", () => {
  assert.match(marketplaceRemovalMessage("removed"), /removed from the marketplace/);
  assert.match(marketplaceRemovalMessage("already_removed"), /already off/);
  assert.match(marketplaceRemovalMessage("not_posted"), /not on the marketplace/);
  assert.match(marketplaceRemovalMessage("has_driver"), /driver is assigned/);
  assert.match(marketplaceRemovalMessage("has_payment"), /payment/);
  assert.match(marketplaceRemovalMessage("has_dispute"), /dispute/);
  assert.match(marketplaceRemovalMessage("other"), /could not be removed/);
});
