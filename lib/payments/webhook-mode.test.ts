import assert from "node:assert/strict";
import test from "node:test";
import { webhookSecretAgrees, webhookSecretCandidates } from "./webhook-mode";

const env = {
  STRIPE_WEBHOOK_SECRET: "whsec_test_platform",
  STRIPE_LIVE_WEBHOOK_SECRET: "whsec_live_platform",
  STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_test_connect",
  STRIPE_LIVE_CONNECT_WEBHOOK_SECRET: "whsec_live_connect",
};

test("platform and connect webhooks keep a secret for each mode", () => {
  assert.deepEqual(
    webhookSecretCandidates("payments", env).map((item) => item.mode),
    ["test", "live"],
  );
  assert.deepEqual(
    webhookSecretCandidates("connect", env).map((item) => item.secret),
    ["whsec_test_connect", "whsec_live_connect"],
  );
});

test("a blank or non-signing secret is not used", () => {
  assert.deepEqual(webhookSecretCandidates("payments", { STRIPE_WEBHOOK_SECRET: "", STRIPE_LIVE_WEBHOOK_SECRET: "live" }), []);
});

test("a verified secret is accepted only for its own mode", () => {
  assert.equal(webhookSecretAgrees("test", false), true);
  assert.equal(webhookSecretAgrees("test", true), false);
  assert.equal(webhookSecretAgrees("live", true), true);
  assert.equal(webhookSecretAgrees("live", false), false);
});
