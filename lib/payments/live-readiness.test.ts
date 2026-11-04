import assert from "node:assert/strict";
import test from "node:test";
import { liveDriverCanAccept, payoutRequirementNote, sameModeConnectAccount, showDriverPayoutWarning } from "./connect-eligibility";
import { readFileSync } from "node:fs";
import { modeAlignmentLabel, paymentsModeMayChangeDatabase, paymentsModesMatch } from "./mode-alignment";
import { readStripeLivemode, stripeObjectMatchesMode } from "./object-mode";
import { paymentsMode, transferLivemode, webhookSecretName } from "./payments-mode";
import { reconcilePaymentAction } from "./reconcile";
import { decideTipCharge } from "./saved-card";
import { chooseAuthorization } from "./checkout-choice";

const open = {
  paymentDueAt: "2026-10-29T03:00:00.000Z",
  now: "2026-10-29T02:00:00.000Z",
};

test("livemode is read when the Stripe type omits it", () => {
  assert.equal(readStripeLivemode({ livemode: false }), false);
  assert.equal(readStripeLivemode({ livemode: true }), true);
  assert.equal(readStripeLivemode({ id: "acct_test" }), null);
  assert.equal(readStripeLivemode({ livemode: "true" }), null);
});

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
  assert.match(payoutRequirementNote("live", false), /Stripe has to enable payouts and transfers/);
  assert.match(payoutRequirementNote("live", false, false), /does not have a Stripe payout account/);
  assert.doesNotMatch(payoutRequirementNote("live", false, false), /Stripe has to enable/);
  assert.match(payoutRequirementNote("test", false), /You can still take jobs/);
  assert.equal(showDriverPayoutWarning(null), true);
  assert.equal(showDriverPayoutWarning({ payouts_enabled: true, transfers_active: false }), true);
  assert.equal(showDriverPayoutWarning({ payouts_enabled: false, transfers_active: true }), true);
  assert.equal(showDriverPayoutWarning({ payouts_enabled: true, transfers_active: true }), false);
  const driverHome = readFileSync(new URL("../../app/driver/page.tsx", import.meta.url), "utf8");
  assert.match(driverHome, /showDriverPayoutWarning\(connect\)/);
  assert.equal(driverHome.includes("Stripe has to enable payouts"), false);
});

test("payout setup saves the current-mode account before Stripe onboarding and resumes it", () => {
  const actions = readFileSync(new URL("../../app/driver/connect/actions.ts", import.meta.url), "utf8");
  const refresh = readFileSync(new URL("../../app/driver/earnings/refresh/route.ts", import.meta.url), "utf8");
  const connect = readFileSync(new URL("./connect.ts", import.meta.url), "utf8");
  const earnings = readFileSync(new URL("../../app/driver/earnings/page.tsx", import.meta.url), "utf8");
  const stripe = readFileSync(new URL("../stripe.ts", import.meta.url), "utf8");
  const mode = readFileSync(new URL("./payments-mode.ts", import.meta.url), "utf8");

  const begin = actions.slice(
    actions.indexOf("export async function beginPayoutSetup"),
    actions.indexOf("export async function startPayoutSetup"),
  );
  const ensureAt = begin.indexOf("ensureExpressAccount");
  const linkAt = begin.indexOf("onboardingLink");
  assert.ok(ensureAt >= 0 && linkAt > ensureAt);
  assert.match(begin, /isNextRedirect\(error\)\) throw error/);
  const start = actions.slice(actions.indexOf("export async function startPayoutSetup"));
  assert.ok(start.indexOf("beginPayoutSetup") >= 0 && start.indexOf("redirect") > start.indexOf("beginPayoutSetup"));
  const refreshEnsure = refresh.indexOf("ensureExpressAccount");
  const refreshLink = refresh.indexOf("onboardingLink");
  const refreshRedirect = refresh.indexOf("redirect");
  assert.ok(refreshEnsure >= 0 && refreshLink > refreshEnsure && refreshRedirect > refreshLink);

  const setup = connect.slice(connect.indexOf("export async function ensureExpressAccount"));
  const createAt = setup.indexOf("v2.core.accounts.create");
  const existingReturn = setup.indexOf("return existingId");
  const existingSave = setup.lastIndexOf("saveConnectAccount", existingReturn);
  const saveAfterCreate = setup.indexOf("await saveConnectAccount(driverId, account)", createAt);
  const returnCreated = setup.indexOf("return account.id", saveAfterCreate);
  assert.ok(existingSave >= 0 && existingSave < existingReturn && existingReturn < createAt);
  assert.ok(saveAfterCreate > createAt && returnCreated > saveAfterCreate);
  assert.match(setup, /idempotencyKey: `connect-account:\$\{driverId\}`/);
  assert.match(setup, /getStripe\(\)/);
  assert.match(actions, /connectLivemode\(paymentsMode\(process\.env\.PAYMENTS_MODE\)\)/);
  assert.match(stripe, /paymentsMode\(process\.env\.PAYMENTS_MODE\)/);
  assert.match(mode, /secret: env\.STRIPE_LIVE_SECRET_KEY/);

  const refreshAt = earnings.indexOf("refreshConnectAccount");
  const freshAt = earnings.indexOf("const { data: fresh }");
  assert.match(earnings, /query\.connect === "return" && data\?\.stripe_account_id/);
  assert.ok(refreshAt >= 0 && freshAt > refreshAt);
});

test("transfer reconciliation does not send a live charge while the switch is test", () => {
  assert.equal(transferLivemode("test"), false);
  assert.equal(transferLivemode("live"), true);
  assert.equal(stripeObjectMatchesMode("test", true), false);
  assert.equal(
    reconcilePaymentAction({
      recordedLivemode: false,
      livemode: true,
      intentStatus: "requires_capture",
      jobStatus: "assigned",
      paymentStatus: "awaiting_payment",
      ...open,
    }),
    "report_mismatch",
  );
});

test("emergency rollback leaves new live work off, and an existing hold follows its saved mode", () => {
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
  assert.equal(reconcilePaymentAction({ recordedLivemode: false, ...hold }), "report_mismatch");
  assert.equal(reconcilePaymentAction({ recordedLivemode: true, ...hold }), "authorize");
});
