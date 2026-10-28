import assert from "node:assert/strict";
import test from "node:test";
import { stripeKeyMode, stripeModeProblem, stripeRefundAction } from "./stripe-mode";

test("test and live keys cannot be mixed, and live mode stays closed", () => {
  assert.equal(stripeKeyMode("sk_test_123"), "test");
  assert.equal(stripeKeyMode("pk_test_123"), "test");
  assert.equal(stripeKeyMode("sk_live_123"), "live");
  assert.equal(stripeKeyMode("pk_live_123"), "live");
  assert.equal(stripeKeyMode(""), "missing");
  assert.equal(stripeModeProblem("sk_test_123", "pk_test_123"), null);
  assert.equal(stripeModeProblem("sk_test_123", "pk_live_123"), "Live payments are not enabled.");
  assert.equal(stripeModeProblem("sk_live_123", "pk_live_123"), "Live payments are not enabled.");
  assert.equal(stripeModeProblem("sk_test_123", ""), "The publishable key is not a test key.");
  assert.equal(stripeModeProblem("", "pk_test_123"), "Stripe test mode is not configured.");
});

test("a dashboard refund is recorded once, and an in-app refund keeps its own path", () => {
  assert.equal(stripeRefundAction({ metadataRefundId: null, status: "pending" }), "pending");
  assert.equal(stripeRefundAction({ metadataRefundId: null, status: "succeeded" }), "external");
  assert.equal(stripeRefundAction({ metadataRefundId: null, status: "failed" }), "external");
  assert.equal(stripeRefundAction({ metadataRefundId: "8b2c", status: "succeeded" }), "app");
});
