import assert from "node:assert/strict";
import test from "node:test";
import { connectWebhookEvents } from "./event-types";
import { accountMatch, connectWebhookAction, connectWebhookSecretName, payoutRecordStatus, unknownDriverNote } from "./connect-plan";

test("Connect events map to one handler, and payment events are ignored", () => {
  assert.equal(connectWebhookSecretName, "STRIPE_CONNECT_WEBHOOK_SECRET");
  for (const type of connectWebhookEvents) {
    assert.notEqual(connectWebhookAction(type), "ignore", type);
  }
  assert.equal(connectWebhookAction("account.updated"), "account");
  assert.equal(connectWebhookAction("transfer.created"), "transfer");
  assert.equal(connectWebhookAction("transfer.updated"), "transfer");
  assert.equal(connectWebhookAction("transfer.reversed"), "transfer");
  assert.equal(connectWebhookAction("payout.paid"), "payout");
  assert.equal(connectWebhookAction("payout.failed"), "payout");
  assert.equal(connectWebhookAction("payment_intent.succeeded"), "ignore");
  assert.equal(connectWebhookAction("checkout.session.completed"), "ignore");
});

test("an unknown Connect account is stored and ignored instead of failing", () => {
  assert.equal(unknownDriverNote, "ignored — no matching driver");
  assert.equal(accountMatch({ driverId: null, driverExists: false }), "ignore");
  assert.equal(accountMatch({ driverId: "not-a-driver", driverExists: false }), "ignore");
  assert.equal(accountMatch({ driverId: "driver-1", driverExists: true }), "save");
});

test("a payout event records paid or failed, and a transfer is not a payout", () => {
  assert.equal(payoutRecordStatus("payout.paid"), "paid");
  assert.equal(payoutRecordStatus("payout.failed"), "failed");
  assert.equal(payoutRecordStatus("transfer.created"), null);
});
