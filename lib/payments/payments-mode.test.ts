import assert from "node:assert/strict";
import test from "node:test";
import { stripeModeProblem } from "../stripe-mode";
import {
  driverNeedsLivePayouts,
  paymentsMode,
  recordedPaymentSecret,
  stripeEnvForMode,
  transferLivemode,
  webhookSecretName,
} from "./payments-mode";

const env = {
  STRIPE_SECRET_KEY: "sk_test_current",
  STRIPE_TEST_SECRET_KEY: "sk_test_historical",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_current",
  STRIPE_WEBHOOK_SECRET: "whsec_test_payments",
  STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_test_connect",
  STRIPE_LIVE_SECRET_KEY: "sk_live_saved",
  NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY: "pk_live_saved",
  STRIPE_LIVE_WEBHOOK_SECRET: "whsec_live_payments",
  STRIPE_LIVE_CONNECT_WEBHOOK_SECRET: "whsec_live_connect",
};

test("the switch defaults to test and ignores saved live keys", () => {
  assert.equal(paymentsMode(undefined), "test");
  assert.equal(paymentsMode("test"), "test");
  assert.equal(paymentsMode("LIVE"), "test");
  const selected = stripeEnvForMode("test", env);
  assert.equal(selected.secret, "sk_test_current");
  assert.equal(selected.publishable, "pk_test_current");
  assert.equal(selected.paymentsWebhook, "whsec_test_payments");
  assert.equal(selected.connectWebhook, "whsec_test_connect");
  assert.equal(stripeModeProblem(selected.secret, selected.publishable, "test"), null);
  assert.equal(transferLivemode("test"), false);
  assert.equal(driverNeedsLivePayouts("test", false), false);
  assert.equal(webhookSecretName("payments", "test"), "STRIPE_WEBHOOK_SECRET");
  assert.equal(webhookSecretName("connect", "test"), "STRIPE_CONNECT_WEBHOOK_SECRET");
});

test("an old test payment reads the test secret and an old live payment reads a live secret", () => {
  const historical = recordedPaymentSecret(false, env);
  assert.equal(historical.name, "STRIPE_TEST_SECRET_KEY");
  assert.equal(historical.value, "sk_test_historical");
  const liveNamed = recordedPaymentSecret(true, { ...env, STRIPE_SECRET_KEY: "sk_live_current" });
  assert.equal(liveNamed.name, "STRIPE_SECRET_KEY");
  assert.equal(liveNamed.value, "sk_live_current");
  const liveDedicated = recordedPaymentSecret(true, env);
  assert.equal(liveDedicated.name, "STRIPE_LIVE_SECRET_KEY");
  assert.equal(liveDedicated.value, "sk_live_saved");
  assert.equal(liveDedicated.value.startsWith("sk_test_"), false);
  assert.throws(() => recordedPaymentSecret(false, { ...env, STRIPE_TEST_SECRET_KEY: "sk_live_saved" }), /test mode is not configured/);
  assert.throws(() => recordedPaymentSecret(true, { STRIPE_SECRET_KEY: "sk_test_current", STRIPE_TEST_SECRET_KEY: "sk_test_historical" }), /Live payments are not configured/);
});

test("live mode reads only the live names and refuses a mixed or test pair", () => {
  assert.equal(paymentsMode("live"), "live");
  const selected = stripeEnvForMode("live", env);
  assert.equal(selected.secret, "sk_live_saved");
  assert.equal(selected.publishable, "pk_live_saved");
  assert.equal(selected.paymentsWebhook, "whsec_live_payments");
  assert.equal(selected.connectWebhook, "whsec_live_connect");
  assert.equal(selected.secret === env.STRIPE_SECRET_KEY, false);
  assert.equal(stripeModeProblem(selected.secret, selected.publishable, "live"), null);
  assert.equal(stripeModeProblem("sk_test_current", "pk_test_current", "live"), "Live payments are not configured.");
  assert.equal(stripeModeProblem("sk_live_saved", "pk_test_current", "live"), "Live and test Stripe keys cannot be mixed.");
  assert.equal(stripeModeProblem("sk_test_current", "pk_live_saved", "test"), "Live and test Stripe keys cannot be mixed.");
  assert.equal(stripeModeProblem("sk_live_saved", "pk_live_saved", "test"), "Live payments are not enabled.");
  assert.equal(transferLivemode("live"), true);
  assert.equal(driverNeedsLivePayouts("live", false), true);
  assert.equal(driverNeedsLivePayouts("live", true), false);
  assert.equal(webhookSecretName("payments", "live"), "STRIPE_LIVE_WEBHOOK_SECRET");
  assert.equal(webhookSecretName("connect", "live"), "STRIPE_LIVE_CONNECT_WEBHOOK_SECRET");
});
