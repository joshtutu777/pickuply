import assert from "node:assert/strict";
import test from "node:test";
import { missingTransfersCapability, transferReadiness, transfersCapabilityActive } from "./transfer-readiness";
import { nextTransferStep } from "./transfer-match";

const now = new Date("2026-10-29T12:00:00.000Z");
const justFinished = new Date("2026-10-29T12:00:00.000Z");
const withinHold = new Date("2026-10-27T12:00:01.000Z");
const holdElapsed = new Date("2026-10-27T12:00:00.000Z");
const chargeStillPending = new Date("2026-11-05T00:00:00.000Z");

const readyDriver = {
  payable: true,
  completedAt: justFinished,
  now,
  completedJobCount: 6,
  disputeHold: false,
  payoutsEnabled: true,
  transfersActive: true,
  alreadyTransferred: false,
  chargeAvailableOn: chargeStillPending,
};

test("an established driver is transferred at completion even while the charge is still pending", () => {
  assert.equal(transferReadiness(readyDriver), "send");
  assert.equal(transferReadiness({ ...readyDriver, completedJobCount: 5 }), "send");
});

test("a new driver waits 48 hours after completion", () => {
  assert.equal(transferReadiness({ ...readyDriver, completedJobCount: 4, completedAt: withinHold }), "hold_new_driver");
  assert.equal(transferReadiness({ ...readyDriver, completedJobCount: 1, completedAt: justFinished }), "hold_new_driver");
  assert.equal(transferReadiness({ ...readyDriver, completedJobCount: 4, completedAt: holdElapsed }), "send");
});

test("an open dispute holds the transfer", () => {
  assert.equal(transferReadiness({ ...readyDriver, disputeHold: true }), "hold_dispute");
  assert.equal(
    transferReadiness({ ...readyDriver, disputeHold: true, completedJobCount: 1, completedAt: holdElapsed }),
    "hold_dispute",
  );
});

test("a missing transfers capability needs payout setup", () => {
  assert.equal(transfersCapabilityActive("active"), true);
  assert.equal(transfersCapabilityActive("pending"), false);
  assert.equal(transfersCapabilityActive(null), false);
  assert.equal(transferReadiness({ ...readyDriver, transfersActive: false }), "needs_payout_setup");
  assert.equal(transferReadiness({ ...readyDriver, payoutsEnabled: false, transfersActive: true }), "needs_payout_setup");
  assert.equal(
    missingTransfersCapability({ code: "insufficient_capabilities_for_transfer", message: "The account cannot receive transfers." }),
    true,
  );
  assert.equal(missingTransfersCapability(new Error("You have insufficient funds in your Stripe account for this transfer.")), false);
});

test("a ledger row that already has a transfer is not sent again", () => {
  assert.equal(transferReadiness({ ...readyDriver, alreadyTransferred: true }), "already_sent");
  assert.equal(nextTransferStep("send", "found"), "record");
  assert.equal(nextTransferStep("recorded", "absent"), "record");
});
