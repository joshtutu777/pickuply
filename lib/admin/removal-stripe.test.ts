import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canFinishRemoval,
  isRemovalIntentId,
  removalLivemode,
  removalStripeErrorCategory,
  removalStripeIdCount,
  removalStripeIds,
  removalStripeSecret,
  removalStripeVerdict,
  type RemovalStripeIds,
} from "./removal-stripe";

const empty: RemovalStripeIds = { sessions: [], intents: [], charges: [] };

test("a request with no payment records has nothing to verify", () => {
  const ids = removalStripeIds({ jobIntent: null, payments: [], attempts: [] });
  assert.equal(ids.ok, true);
  if (!ids.ok) return;
  assert.deepEqual(ids.ids, empty);
  assert.equal(canFinishRemoval(ids.ids, null), true);
  assert.equal(removalStripeVerdict([]), "inactive");
});

test("an abandoned checkout session is inactive only when Stripe says it expired unpaid", () => {
  const ids = removalStripeIds({
    jobIntent: null,
    payments: [{ checkout_session_id: "cs_abandoned", payment_intent_id: null, charge_id: null }],
    attempts: [
      { checkout_session_id: "cs_abandoned", payment_intent_id: null },
      { checkout_session_id: "cs_abandoned", payment_intent_id: null },
    ],
  });
  assert.equal(ids.ok, true);
  if (!ids.ok) return;
  assert.deepEqual(ids.ids.sessions, ["cs_abandoned"]);
  assert.equal(ids.ids.intents.length, 0);
  assert.equal(
    removalStripeVerdict([{ kind: "session", status: "expired", paymentStatus: "unpaid" }]),
    "inactive",
  );
  assert.equal(canFinishRemoval(ids.ids, "inactive"), true);
  assert.equal(canFinishRemoval(ids.ids, null), false);
});

test("a failed charge with no capture can be removed", () => {
  const ids = removalStripeIds({
    jobIntent: null,
    payments: [{ checkout_session_id: null, payment_intent_id: null, charge_id: "ch_failed" }],
    attempts: [],
  });
  assert.equal(ids.ok, true);
  if (!ids.ok) return;
  assert.equal(
    removalStripeVerdict([{ kind: "charge", status: "failed", paid: false, refunded: false, amountRefunded: 0, disputed: false }]),
    "inactive",
  );
  assert.equal(canFinishRemoval(ids.ids, "inactive"), true);
});

test("a canceled PaymentIntent with nothing received or capturable is inactive", () => {
  assert.equal(
    removalStripeVerdict([{ kind: "intent", status: "canceled", amountReceived: 0, amountCapturable: 0 }]),
    "inactive",
  );
  assert.equal(
    removalStripeVerdict([{ kind: "intent", status: "canceled", amountReceived: 5000, amountCapturable: 0 }]),
    "active",
  );
});

test("an expired authorization is inactive only when Stripe reports the PaymentIntent canceled", () => {
  assert.equal(
    removalStripeVerdict([{ kind: "intent", status: "canceled", amountReceived: 0, amountCapturable: 0 }]),
    "inactive",
  );
  assert.equal(
    removalStripeVerdict([{ kind: "intent", status: "expired", amountReceived: 0, amountCapturable: 0 }]),
    "active",
  );
  assert.equal(
    removalStripeVerdict([{ kind: "intent", status: "requires_payment_method", amountReceived: 0, amountCapturable: 0 }]),
    "active",
  );
});

test("an active authorization blocks removal", () => {
  assert.equal(
    removalStripeVerdict([{ kind: "intent", status: "requires_capture", amountReceived: 0, amountCapturable: 5000 }]),
    "active",
  );
  assert.equal(canFinishRemoval({ ...empty, intents: ["pi_hold"] }, "active"), false);
});

test("a captured payment blocks removal", () => {
  assert.equal(
    removalStripeVerdict([{ kind: "intent", status: "succeeded", amountReceived: 5000, amountCapturable: 0 }]),
    "active",
  );
  assert.equal(
    removalStripeVerdict([{ kind: "charge", status: "succeeded", paid: true, refunded: false, amountRefunded: 0, disputed: false }]),
    "active",
  );
});

test("a refund or a dispute blocks removal", () => {
  assert.equal(
    removalStripeVerdict([{ kind: "charge", status: "succeeded", paid: true, refunded: true, amountRefunded: 5000, disputed: false }]),
    "active",
  );
  assert.equal(
    removalStripeVerdict([{ kind: "charge", status: "failed", paid: false, refunded: false, amountRefunded: 0, disputed: true }]),
    "active",
  );
});

test("an open or completed checkout blocks removal", () => {
  assert.equal(removalStripeVerdict([{ kind: "session", status: "open", paymentStatus: "unpaid" }]), "active");
  assert.equal(removalStripeVerdict([{ kind: "session", status: "complete", paymentStatus: "unpaid" }]), "active");
  assert.equal(removalStripeVerdict([{ kind: "session", status: "expired", paymentStatus: "paid" }]), "active");
});

test("a Stripe gap blocks removal and does not count as inactive", () => {
  assert.equal(removalStripeVerdict([{ kind: "session", status: null, paymentStatus: "unpaid" }]), "unverified");
  assert.equal(removalStripeVerdict([{ kind: "intent", status: "canceled", amountReceived: null, amountCapturable: 0 }]), "unverified");
  assert.equal(removalStripeVerdict([{ kind: "charge", status: "failed", paid: null, refunded: false, disputed: false }]), "unverified");
  assert.equal(canFinishRemoval({ ...empty, sessions: ["cs_missing"] }, "unverified"), false);
  assert.equal(canFinishRemoval({ ...empty, sessions: ["cs_missing"] }, null), false);
});

test("one active object blocks a set that also contains an expired session", () => {
  assert.equal(
    removalStripeVerdict([
      { kind: "session", status: "expired", paymentStatus: "unpaid" },
      { kind: "intent", status: "requires_capture", amountReceived: 0, amountCapturable: 1000 },
    ]),
    "active",
  );
});

test("a stored id with the wrong shape is not sent to Stripe", () => {
  const malformed = [
    "not-a-stripe-id",
    "cs_live_bad id",
    "cs_test_bad/id",
    "CS_LIVE_ABC",
    "py_123",
    "cs_",
  ];
  for (const value of malformed) {
    const ids = removalStripeIds({
      jobIntent: null,
      payments: [{ checkout_session_id: value, payment_intent_id: null, charge_id: null }],
      attempts: [],
    });
    assert.equal(ids.ok, false, value);
  }
  assert.equal(
    removalStripeIds({ jobIntent: "pi_live bad", payments: [], attempts: [] }).ok,
    false,
  );
  assert.equal(
    removalStripeIds({
      jobIntent: null,
      payments: [{ checkout_session_id: null, payment_intent_id: null, charge_id: "ch_live bad" }],
      attempts: [],
    }).ok,
    false,
  );
  assert.equal(removalStripeIdCount(empty), 0);
});

test("live and test Stripe ids are accepted and still checked", () => {
  const ids = removalStripeIds({
    jobIntent: "pi_3Nq2abcDEF123",
    payments: [{
      checkout_session_id: "cs_live_a1B2c3D4",
      payment_intent_id: "pi_3Nq2abcDEF123",
      charge_id: "ch_3Nq2abcDEF123",
    }],
    attempts: [{
      checkout_session_id: "cs_test_a1B2c3D4",
      payment_intent_id: "pi_3TestIntent",
    }],
  });
  assert.equal(ids.ok, true);
  if (!ids.ok) return;
  assert.deepEqual(ids.ids.sessions, ["cs_live_a1B2c3D4", "cs_test_a1B2c3D4"]);
  assert.deepEqual(ids.ids.intents, ["pi_3Nq2abcDEF123", "pi_3TestIntent"]);
  assert.deepEqual(ids.ids.charges, ["ch_3Nq2abcDEF123"]);
  assert.equal(isRemovalIntentId("pi_3Nq2abc_DEF"), true);
  assert.equal(isRemovalIntentId("pi_live bad"), false);
  assert.equal(
    removalStripeVerdict([{ kind: "session", status: "expired", paymentStatus: "unpaid" }]),
    "inactive",
  );
  assert.equal(canFinishRemoval(ids.ids, "inactive"), true);
  assert.equal(canFinishRemoval(ids.ids, "active"), false);
  assert.equal(canFinishRemoval(ids.ids, "unverified"), false);
});

const saved = { sessions: ["cs_saved"], intents: [] as string[], charges: [] as string[] };
const keys = {
  STRIPE_LIVE_SECRET_KEY: "sk_live_removal",
  STRIPE_TEST_SECRET_KEY: "sk_test_removal",
  STRIPE_SECRET_KEY: "sk_test_current",
};

test("a saved live payment selects the live secret", () => {
  const selected = removalStripeSecret(true, { sessions: ["cs_live_saved"], intents: [], charges: [] }, keys);
  assert.equal(selected.ok, true);
  if (!selected.ok) return;
  assert.equal(selected.name, "STRIPE_LIVE_SECRET_KEY");
  assert.equal(selected.secret, "sk_live_removal");
  const unprefixed = removalStripeSecret(true, saved, keys);
  assert.equal(unprefixed.ok, true);
  if (!unprefixed.ok) return;
  assert.equal(unprefixed.name, "STRIPE_LIVE_SECRET_KEY");
});

test("a saved test payment selects the test secret", () => {
  const selected = removalStripeSecret(false, { sessions: ["cs_test_saved"], intents: [], charges: [] }, keys);
  assert.equal(selected.ok, true);
  if (!selected.ok) return;
  assert.equal(selected.name, "STRIPE_TEST_SECRET_KEY");
  assert.equal(selected.secret, "sk_test_removal");
  const current = removalStripeSecret(false, saved, { STRIPE_SECRET_KEY: "sk_test_current" });
  assert.equal(current.ok, true);
  if (!current.ok) return;
  assert.equal(current.name, "STRIPE_SECRET_KEY");
});

test("the id prefix cannot supply a missing mode or override the saved mode", () => {
  const missing = removalStripeSecret("unknown", { sessions: ["cs_live_saved"], intents: [], charges: [] }, keys);
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.code, "mode_unknown");
  const mismatched = removalStripeSecret(false, { sessions: ["cs_live_saved"], intents: [], charges: [] }, keys);
  assert.equal(mismatched.ok, false);
  if (mismatched.ok) return;
  assert.equal(mismatched.code, "mode_mismatch");
  assert.equal(removalLivemode([{
    checkout_session_id: "cs_saved",
    payment_intent_id: null,
    charge_id: null,
    stripe_livemode: null,
  }]), "unknown");
  assert.equal(removalLivemode([
    { checkout_session_id: "cs_one", payment_intent_id: null, charge_id: null, stripe_livemode: true },
    { checkout_session_id: "cs_two", payment_intent_id: null, charge_id: null, stripe_livemode: false },
  ]), "mixed");
});

test("a missing or wrong key does not fall back to another Stripe account", () => {
  const missingLive = removalStripeSecret(true, saved, {
    STRIPE_SECRET_KEY: "sk_live_other",
    STRIPE_TEST_SECRET_KEY: "sk_test_removal",
  });
  assert.equal(missingLive.ok, false);
  if (missingLive.ok) return;
  assert.equal(missingLive.code, "key_missing");
  assert.equal(missingLive.name, "STRIPE_LIVE_SECRET_KEY");
  const wrongTest = removalStripeSecret(false, saved, {
    STRIPE_TEST_SECRET_KEY: "sk_live_wrong",
    STRIPE_SECRET_KEY: "sk_test_current",
  });
  assert.equal(wrongTest.ok, false);
  if (wrongTest.ok) return;
  assert.equal(wrongTest.name, "STRIPE_TEST_SECRET_KEY");
});

test("an expired unpaid session can be removed and active money stays blocked", () => {
  const ids = { sessions: ["cs_saved"], intents: ["pi_saved"], charges: [] };
  assert.equal(removalStripeVerdict([{ kind: "session", status: "expired", paymentStatus: "unpaid" }]), "inactive");
  assert.equal(canFinishRemoval(ids, "inactive"), true);
  assert.equal(canFinishRemoval(ids, null), false);
  assert.equal(
    removalStripeVerdict([{ kind: "intent", status: "requires_capture", amountReceived: 0, amountCapturable: 5000 }]),
    "active",
  );
  assert.equal(
    removalStripeVerdict([{ kind: "charge", status: "succeeded", paid: true, refunded: false, amountRefunded: 0, disputed: false }]),
    "active",
  );
  assert.equal(removalStripeErrorCategory({ code: "resource_missing", message: "No such checkout.session: cs_live_private" }), "resource_missing");
});

test("removal verification only retrieves Stripe objects", () => {
  const source = readFileSync(new URL("./removal-stripe-read.ts", import.meta.url), "utf8");
  assert.match(source, /checkout\.sessions\.retrieve/);
  assert.match(source, /paymentIntents\.retrieve/);
  assert.match(source, /charges\.retrieve/);
  assert.doesNotMatch(source, /\.(create|capture|cancel|refunds|expire)\(/);
});
