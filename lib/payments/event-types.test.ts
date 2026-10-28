import assert from "node:assert/strict";
import test from "node:test";
import { connectWebhookEvents, isListedEvent, platformPaymentEvents } from "./event-types";

test("platform and Connect webhooks handle different events", () => {
  assert.equal(isListedEvent("checkout.session.completed", platformPaymentEvents), true);
  assert.equal(isListedEvent("charge.dispute.created", platformPaymentEvents), true);
  assert.equal(isListedEvent("charge.refunded", platformPaymentEvents), true);
  assert.equal(isListedEvent("transfer.created", platformPaymentEvents), true);
  assert.equal(isListedEvent("transfer.reversed", platformPaymentEvents), true);
  assert.equal(isListedEvent("account.updated", platformPaymentEvents), false);
  assert.equal(isListedEvent("payout.paid", platformPaymentEvents), false);
  assert.equal(isListedEvent("customer.created", platformPaymentEvents), false);
  assert.equal(isListedEvent("account.updated", connectWebhookEvents), true);
  assert.equal(isListedEvent("payout.paid", connectWebhookEvents), true);
  assert.equal(isListedEvent("payout.failed", connectWebhookEvents), true);
  assert.equal(isListedEvent("checkout.session.completed", connectWebhookEvents), false);
});
