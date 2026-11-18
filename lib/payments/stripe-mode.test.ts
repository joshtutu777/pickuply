import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { connectAccountLivemode, transfersCapabilityActive } from "./object-mode";
import { newLiveChargeDecision, paidBookingsEnabled } from "./paid-bookings";
import {
  paymentsMode,
  recordedPaymentSecret,
  stripeEnvForMode,
  webhookSecretName,
} from "./payments-mode";
import { stripeModeProblem } from "../stripe-mode";

const liveSecret = "sk_live_example";
const livePublishable = "pk_live_example";
const testSecret = "sk_test_example";
const testPublishable = "pk_test_example";
const dedicatedTest = "sk_test_dedicated";

test("only the exact value live selects live mode", () => {
  assert.equal(paymentsMode("live"), "live");
  assert.equal(paymentsMode("LIVE"), "test");
  assert.equal(paymentsMode(" true "), "test");
  assert.equal(paymentsMode(undefined), "test");
  assert.equal(paymentsMode(""), "test");
});

test("a mixed test and live key pair is refused", () => {
  assert.equal(stripeModeProblem(liveSecret, testPublishable, "live"), "Live and test Stripe keys cannot be mixed.");
  assert.equal(stripeModeProblem(testSecret, livePublishable, "test"), "Live and test Stripe keys cannot be mixed.");
});

test("live mode uses the live pair and test mode uses the test pair", () => {
  const live = stripeEnvForMode("live", {
    STRIPE_LIVE_SECRET_KEY: liveSecret,
    NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY: livePublishable,
    STRIPE_SECRET_KEY: testSecret,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: testPublishable,
  });
  assert.equal(live.secret, liveSecret);
  assert.equal(live.publishable, livePublishable);
  assert.equal(stripeModeProblem(live.secret, live.publishable, "live"), null);

  const testMode = stripeEnvForMode("test", {
    STRIPE_LIVE_SECRET_KEY: liveSecret,
    STRIPE_SECRET_KEY: testSecret,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: testPublishable,
  });
  assert.equal(testMode.secret, testSecret);
  assert.equal(testMode.secret?.includes("live"), false);
  assert.equal(stripeModeProblem(testMode.secret, testMode.publishable, "test"), null);
});

test("the paid-bookings gate blocks a new live charge unless the flag is exactly true", () => {
  assert.equal(paidBookingsEnabled("true"), true);
  assert.equal(paidBookingsEnabled("TRUE"), false);
  assert.equal(paidBookingsEnabled("false"), false);
  assert.equal(paidBookingsEnabled(undefined), false);
  assert.equal(newLiveChargeDecision({ paymentsMode: "test", paidBookings: undefined }), "allow");
  assert.equal(newLiveChargeDecision({ paymentsMode: "live", paidBookings: "false" }), "block");
  assert.equal(newLiveChargeDecision({ paymentsMode: "live", paidBookings: undefined }), "block");
  assert.equal(newLiveChargeDecision({ paymentsMode: "live", paidBookings: "true" }), "allow");
});

test("a saved live payment never uses a test key, and a saved test payment never uses a live key", () => {
  const env = {
    STRIPE_SECRET_KEY: testSecret,
    STRIPE_TEST_SECRET_KEY: dedicatedTest,
    STRIPE_LIVE_SECRET_KEY: liveSecret,
  };
  const live = recordedPaymentSecret(true, env);
  assert.equal(live.name, "STRIPE_LIVE_SECRET_KEY");
  assert.equal(live.value, liveSecret);
  const testRow = recordedPaymentSecret(false, env);
  assert.equal(testRow.name, "STRIPE_SECRET_KEY");
  assert.equal(testRow.value, testSecret);

  const switched = recordedPaymentSecret(false, { ...env, STRIPE_SECRET_KEY: liveSecret });
  assert.equal(switched.name, "STRIPE_TEST_SECRET_KEY");
  assert.equal(switched.value, dedicatedTest);
  assert.throws(() => recordedPaymentSecret(true, { STRIPE_SECRET_KEY: liveSecret }), /Live payments are not configured/);
  assert.throws(() => recordedPaymentSecret(false, { STRIPE_SECRET_KEY: liveSecret }), /Stripe test mode is not configured/);
});

test("webhook secrets follow the payments mode", () => {
  assert.equal(webhookSecretName("payments", "live"), "STRIPE_LIVE_WEBHOOK_SECRET");
  assert.equal(webhookSecretName("connect", "live"), "STRIPE_LIVE_CONNECT_WEBHOOK_SECRET");
  assert.equal(webhookSecretName("payments", "test"), "STRIPE_WEBHOOK_SECRET");
  assert.equal(webhookSecretName("connect", "test"), "STRIPE_CONNECT_WEBHOOK_SECRET");
});

test("a Connect account keeps the mode of the key that retrieved it", () => {
  assert.equal(connectAccountLivemode({}, true), true);
  assert.equal(connectAccountLivemode({}, false), false);
  assert.equal(connectAccountLivemode({ livemode: true }, true), true);
  assert.equal(connectAccountLivemode({ livemode: false }, true), null);
  assert.equal(connectAccountLivemode({ livemode: false }, false), false);
  assert.equal(transfersCapabilityActive("active"), true);
  assert.equal(transfersCapabilityActive("pending"), false);
  assert.equal(transfersCapabilityActive(null), false);
});

test("checkout, capture, refunds, deadlines, and transfers stay on the saved mode", () => {
  const checkout = readFileSync(new URL("../../app/jobs/pay/actions.ts", import.meta.url), "utf8");
  const capture = readFileSync(new URL("./capture.ts", import.meta.url), "utf8");
  const refunds = readFileSync(new URL("./refunds.ts", import.meta.url), "utf8");
  const deadlines = readFileSync(new URL("../../app/api/cron/payment-deadlines/route.ts", import.meta.url), "utf8");
  const transfers = readFileSync(new URL("./transfers.ts", import.meta.url), "utf8");
  const transferStripe = readFileSync(new URL("./transfer-stripe.ts", import.meta.url), "utf8");
  const connect = readFileSync(new URL("./connect.ts", import.meta.url), "utf8");
  const platform = readFileSync(new URL("./platform-events.ts", import.meta.url), "utf8");
  const webhook = readFileSync(new URL("../../app/api/stripe/webhook/route.ts", import.meta.url), "utf8");
  const connectWebhook = readFileSync(new URL("../../app/api/stripe/connect/route.ts", import.meta.url), "utf8");

  assert.equal(checkout.indexOf("newLiveChargeDecision") < checkout.indexOf("checkout.sessions.create"), true);
  assert.match(checkout, /capture_method:\s*"manual"/);
  assert.match(checkout, /idempotencyKey:\s*`checkout:\$\{jobId\}:\$\{row\.attempt\}`/);
  assert.match(checkout, /checkout\.sessions\.expire/);

  assert.equal(capture.includes("getStripe()"), false);
  assert.match(capture, /stripeForJob/);
  assert.match(capture, /idempotencyKey:\s*`capture:\$\{row\.payment_intent_id\}:full`/);
  assert.match(capture, /intent\.status !== "succeeded"/);

  assert.equal(refunds.includes("getStripe()"), false);
  assert.match(refunds, /stripeForJob/);
  assert.match(refunds, /idempotencyKey:\s*`refund:\$\{row\.refund_id\}`/);
  assert.match(refunds, /idempotencyKey:\s*`reversal:\$\{obligationId\}`/);

  assert.equal(deadlines.includes("getStripe()"), false);
  assert.match(deadlines, /stripeForJob/);
  assert.match(deadlines, /idempotencyKey:\s*`cancel-deadline:\$\{row\.payment_intent_id\}`/);

  assert.match(transfers, /ready_transfers",\s*\{\s*target_livemode:\s*livemode\s*\}/);
  assert.match(transfers, /getStripeForRecordedMode\(livemode\)/);
  assert.match(transfers, /entryId:\s*row\.entry_id/);
  assert.match(transferStripe, /idempotencyKey:\s*input\.entryId/);
  assert.match(transferStripe, /input\.idempotencyKey !== input\.entryId/);
  assert.equal(transfers.includes("for (const livemode of [false, true])"), true);

  assert.match(connect, /account_livemode:\s*accountLive/);
  assert.match(connect, /transfers_active:\s*transfersActive/);
  assert.match(connect, /connect-account:\$\{driverId\}:\$\{live \? "live" : "test"\}/);

  assert.equal(platform.includes("getStripe()"), false);
  assert.match(platform, /getStripeForRecordedMode\(intent\.livemode\)/);
  assert.match(platform, /getStripeForRecordedMode\(session\.livemode\)/);
  assert.match(platform, /note_transfer_status/);

  assert.match(webhook, /webhookSecretName\("payments"/);
  assert.match(connectWebhook, /webhookSecretName\("connect"/);
});
