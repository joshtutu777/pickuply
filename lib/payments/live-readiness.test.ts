import assert from "node:assert/strict";
import test from "node:test";
import { liveDriverCanAccept, payoutRequirementNote, sameModeConnectAccount } from "./connect-eligibility";
import { readFileSync } from "node:fs";
import { modeAlignmentLabel, paymentsModeMayChangeDatabase, paymentsModesMatch } from "./mode-alignment";
import { stripeObjectMatchesMode } from "./object-mode";
import { paymentsMode, transferLivemode, webhookSecretName } from "./payments-mode";
import { reconcilePaymentAction } from "./reconcile";
import { decideTipCharge } from "./saved-card";
import { chooseAuthorization } from "./checkout-choice";

const open = {
  paymentDueAt: "2026-10-29T03:00:00.000Z",
  now: "2026-10-29T02:00:00.000Z",
};

test("test checkout and capture stay on test objects", () => {
  assert.equal(paymentsMode(undefined), "test");
  assert.equal(stripeObjectMatchesMode("test", false), true);
  assert.equal(stripeObjectMatchesMode("test", true), false);
  assert.equal(
    chooseAuthorization({
      priceCents: 5250,
      driverId: "driver-1",
      acceptLivemode: false,
      intents: [
        {
          id: "pi_testHold",
          status: "requires_capture",
          amount: 5250,
          driverId: "driver-1",
          created: 1,
          livemode: false,
        },
      ],
    }).acceptId,
    "pi_testHold",
  );
});

test("live checkout and capture use a live object only while the switch is live", () => {
  assert.equal(paymentsMode("live"), "live");
  assert.equal(stripeObjectMatchesMode("live", true), true);
  assert.equal(stripeObjectMatchesMode("live", false), false);
  const intents = [
    {
      id: "pi_liveHold",
      status: "requires_capture",
      amount: 5250,
      driverId: "driver-1",
      created: 2,
      livemode: true,
    },
    {
      id: "pi_testHold",
      status: "requires_capture",
      amount: 5250,
      driverId: "driver-1",
      created: 1,
      livemode: false,
    },
  ];
  assert.equal(
    chooseAuthorization({ priceCents: 5250, driverId: "driver-1", acceptLivemode: true, intents }).acceptId,
    "pi_liveHold",
  );
  assert.equal(
    chooseAuthorization({ priceCents: 5250, driverId: "driver-1", acceptLivemode: false, intents }).acceptId,
    "pi_testHold",
  );
});

test("tips and refunds follow the same mode and a mismatch does not pick a refund", () => {
  assert.equal(decideTipCharge({ paymentsMode: "test", livemode: false, status: "succeeded" }), "paid");
  assert.equal(decideTipCharge({ paymentsMode: "live", livemode: true, status: "succeeded" }), "paid");
  assert.equal(decideTipCharge({ paymentsMode: "test", livemode: true, status: "succeeded" }), "mismatch");
  assert.equal(decideTipCharge({ paymentsMode: "live", livemode: false, status: "succeeded" }), "mismatch");
});

test("webhook secrets stay on their own mode", () => {
  assert.equal(webhookSecretName("payments", "test"), "STRIPE_WEBHOOK_SECRET");
  assert.equal(webhookSecretName("connect", "test"), "STRIPE_CONNECT_WEBHOOK_SECRET");
  assert.equal(webhookSecretName("payments", "live"), "STRIPE_LIVE_WEBHOOK_SECRET");
  assert.equal(webhookSecretName("connect", "live"), "STRIPE_LIVE_CONNECT_WEBHOOK_SECRET");
  assert.equal(webhookSecretName("payments", "live") === webhookSecretName("payments", "test"), false);
});

test("only an admin activation may change the database payment mode", () => {
  for (const source of ["checkout", "driver-accept", "transfer", "capture", "refund", "webhook", "reconcile", "health-view"]) {
    assert.equal(paymentsModeMayChangeDatabase(source), false, source);
  }
  assert.equal(paymentsModeMayChangeDatabase("admin-activation"), true);
  const reader = readFileSync(new URL("./mode-sync.ts", import.meta.url), "utf8");
  const activation = readFileSync(new URL("../../app/admin/health/actions.ts", import.meta.url), "utf8");
  assert.equal(reader.includes(".update("), false);
  assert.equal(reader.includes("activate_payments_mode"), false);
  assert.match(activation, /activate_payments_mode/);
  assert.match(activation, /paymentsMode\(process\.env\.PAYMENTS_MODE\)/);
  assert.equal(activation.includes("formData"), false);
});

test("a payment-mode mismatch is visible and blocks until both sides agree", () => {
  assert.equal(paymentsModesMatch("test", "test"), true);
  assert.equal(paymentsModesMatch("live", "live"), true);
  assert.equal(paymentsModesMatch("live", "test"), false);
  assert.equal(paymentsModesMatch("test", "live"), false);
  assert.deepEqual(modeAlignmentLabel("test", "live"), {
    environment: "test",
    database: "live",
    matches: false,
  });
});

test("a real driver needs a live Connect account with payouts and transfers", () => {
  assert.equal(
    liveDriverCanAccept({
      mode: "live",
      isTestDriver: false,
      payoutsEnabled: true,
      transfersActive: true,
      accountLivemode: true,
    }),
    true,
  );
  assert.equal(
    liveDriverCanAccept({
      mode: "live",
      isTestDriver: false,
      payoutsEnabled: true,
      transfersActive: true,
      accountLivemode: false,
    }),
    false,
  );
  assert.equal(sameModeConnectAccount("live", false), false);
  assert.equal(sameModeConnectAccount("test", false), true);
  assert.equal(
    liveDriverCanAccept({
      mode: "test",
      isTestDriver: false,
      payoutsEnabled: false,
      transfersActive: false,
      accountLivemode: false,
    }),
    true,
  );
  assert.match(payoutRequirementNote("live", false), /live account/);
  assert.match(payoutRequirementNote("test", false), /You can still take jobs/);
});

test("transfer reconciliation does not send a live charge while the switch is test", () => {
  assert.equal(transferLivemode("test"), false);
  assert.equal(transferLivemode("live"), true);
  assert.equal(stripeObjectMatchesMode("test", true), false);
  assert.equal(
    reconcilePaymentAction({
      paymentsMode: "test",
      livemode: true,
      intentStatus: "requires_capture",
      jobStatus: "assigned",
      paymentStatus: "awaiting_payment",
      ...open,
    }),
    "report_mismatch",
  );
});

test("emergency rollback keeps a live hold identifiable and does not capture or authorize it in test mode", () => {
  assert.equal(paymentsMode("test"), "test");
  assert.equal(stripeObjectMatchesMode("test", true), false);
  assert.equal(transferLivemode("test"), false);
  assert.equal(paymentsModesMatch("test", "live"), false);
  assert.equal(paymentsModeMayChangeDatabase("reconcile"), false);
  const hold = {
    livemode: true,
    intentStatus: "requires_capture",
    jobStatus: "assigned",
    paymentStatus: "awaiting_payment",
    ...open,
  } as const;
  assert.equal(reconcilePaymentAction({ paymentsMode: "test", ...hold }), "report_mismatch");
  assert.equal(reconcilePaymentAction({ paymentsMode: "live", ...hold }), "authorize");
});
