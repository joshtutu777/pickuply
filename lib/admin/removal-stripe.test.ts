import assert from "node:assert/strict";
import test from "node:test";
import {
  canFinishRemoval,
  removalStripeIdCount,
  removalStripeIds,
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
  const ids = removalStripeIds({
    jobIntent: "not-a-stripe-id",
    payments: [],
    attempts: [],
  });
  assert.equal(ids.ok, false);
  assert.equal(removalStripeIdCount(empty), 0);
});
