import assert from "node:assert/strict";
import test from "node:test";
import { stripeModeProblem } from "../stripe-mode";
import {
  driverNeedsLivePayouts,
  paymentsMode,
  stripeEnvForMode,
  transferLivemode,
  webhookSecretName,
} from "./payments-mode";

const env = {
  STRIPE_SECRET_KEY: "sk_test_current",
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
