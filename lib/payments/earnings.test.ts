import assert from "node:assert/strict";
import test from "node:test";
import { bankDepositNote, driverEarningCents, earningsAvailability, sentToStripeAccount, sentTransferLine, transferSentNotice } from "./earnings";

test("a completed job earns the driver pay and not the dump estimate", () => {
  assert.equal(
    driverEarningCents({
      completed: true,
      driverPayCents: 8000,
      tripFeeCents: null,
      dumpFeeCents: 4500,
    }),
    8000,
  );
});

test("a rejected pickup earns the trip fee and not the dump estimate", () => {
  assert.equal(
    driverEarningCents({
      completed: false,
      driverPayCents: 8000,
      tripFeeCents: 2500,
      dumpFeeCents: 4500,
    }),
    2500,
  );
});

test("held earnings say payout setup is required", () => {
  const held = earningsAvailability("held_until_onboarding");
  assert.equal(held.label, "Held");
  assert.match(held.detail, /Needs payout setup/);
  assert.equal(earningsAvailability("pending").label, "Pending");
  assert.equal(earningsAvailability("ready").label, "Available");
});

test("a sent transfer names the Stripe account and Stripe's later payout", () => {
  const sentOn = new Date("2026-10-29T16:00:00.000Z");
  const line = sentTransferLine(4250, sentOn);
  assert.equal(line, "✓ $42.50 sent to your Stripe account on Oct 29, 2026.");
  assert.doesNotMatch(line, /bank deposit/i);
  const copy = sentToStripeAccount(sentOn, 4250);
  assert.match(copy, /✓ \$42\.50 sent to your Stripe account on Oct 29, 2026/);
  assert.match(copy, /Bank deposits follow Stripe's payout schedule/);
  assert.equal(copy.includes(bankDepositNote), true);
  assert.doesNotMatch(copy, /Usually in your bank/i);
  assert.doesNotMatch(earningsAvailability("transferred").detail, /Usually in your bank/i);
  assert.equal(
    transferSentNotice(4250, "33fd2571-f19b-4d94-aac5-400972d26f9f"),
    "Your $42.50 for job #D26F9F was sent to your Stripe account",
  );
});
