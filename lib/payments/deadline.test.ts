import assert from "node:assert/strict";
import test from "node:test";
import { settleOverduePayment, settleOverduePayments, type DeadlineStripe } from "./deadline";

function client(livemode: boolean, status: string): DeadlineStripe & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async retrievePaymentIntent() {
      calls.push(`retrieve:${livemode ? "live" : "test"}`);
      return { status, livemode };
    },
    async cancelPaymentIntent(id: string) {
      calls.push(`cancel:${id}`);
    },
  };
}

test("a test PaymentIntent is read and canceled with the test client", async () => {
  const testClient = client(false, "requires_payment_method");
  const liveClient = client(true, "requires_payment_method");
  const released: string[] = [];
  const outcome = await settleOverduePayment(
    { jobId: "job-test", paymentIntentId: "pi_test", recordedLivemode: false },
    (livemode) => (livemode ? liveClient : testClient),
    async (jobId) => {
      released.push(jobId);
      return true;
    },
  );
  assert.equal(outcome, "released");
  assert.deepEqual(testClient.calls, ["retrieve:test", "cancel:pi_test"]);
  assert.deepEqual(liveClient.calls, []);
  assert.deepEqual(released, ["job-test"]);
});

test("a live PaymentIntent is read with the live client", async () => {
  const testClient = client(false, "canceled");
  const liveClient = client(true, "canceled");
  const outcome = await settleOverduePayment(
    { jobId: "job-live", paymentIntentId: "pi_live", recordedLivemode: true },
    (livemode) => (livemode ? liveClient : testClient),
    async () => true,
  );
  assert.equal(outcome, "released");
  assert.deepEqual(liveClient.calls, ["retrieve:live"]);
  assert.deepEqual(testClient.calls, []);
});

test("a canceled PaymentIntent is not canceled again", async () => {
  const testClient = client(false, "canceled");
  const outcome = await settleOverduePayment(
    { jobId: "job-canceled", paymentIntentId: "pi_canceled", recordedLivemode: false },
    () => testClient,
    async () => true,
  );
  assert.equal(outcome, "released");
  assert.deepEqual(testClient.calls, ["retrieve:test"]);
});

test("a missing or mismatched saved mode does not call Stripe or release the driver", async () => {
  let stripeCalls = 0;
  let releases = 0;
  const missing = await settleOverduePayment(
    { jobId: "job-missing", paymentIntentId: "pi_missing", recordedLivemode: null },
    () => {
      stripeCalls += 1;
      return client(false, "canceled");
    },
    async () => {
      releases += 1;
      return true;
    },
  );
  const mismatched = await settleOverduePayment(
    { jobId: "job-mismatch", paymentIntentId: "pi_mismatch", recordedLivemode: false },
    () => ({
      async retrievePaymentIntent() {
        stripeCalls += 1;
        return { status: "canceled", livemode: true };
      },
      async cancelPaymentIntent() {
        stripeCalls += 1;
      },
    }),
    async () => {
      releases += 1;
      return true;
    },
  );
  assert.equal(missing, "missing_mode");
  assert.equal(mismatched, "mode_mismatch");
  assert.equal(stripeCalls, 1);
  assert.equal(releases, 0);
});

test("a second scheduled pass does not cancel or release again", async () => {
  let status = "requires_payment_method";
  let cancels = 0;
  const released = new Set<string>();
  const stripe = (): DeadlineStripe => ({
    async retrievePaymentIntent() {
      return { status, livemode: false };
    },
    async cancelPaymentIntent() {
      cancels += 1;
      status = "canceled";
    },
  });
  const release = async (jobId: string) => {
    if (released.has(jobId)) return false;
    released.add(jobId);
    return true;
  };
  const row = { jobId: "job-twice", paymentIntentId: "pi_twice", recordedLivemode: false as const };
  const first = await settleOverduePayments([row], stripe, release);
  const second = await settleOverduePayments([row], stripe, release);
  assert.deepEqual(first, ["released"]);
  assert.deepEqual(second, ["already_released"]);
  assert.equal(cancels, 1);
});

test("a Stripe failure leaves the assignment in place and the next row still runs", async () => {
  const released: string[] = [];
  const outcomes = await settleOverduePayments(
    [
      { jobId: "job-down", paymentIntentId: "pi_down", recordedLivemode: false },
      { jobId: "job-next", paymentIntentId: "pi_next", recordedLivemode: true },
    ],
    (livemode) => ({
      async retrievePaymentIntent(id: string) {
        if (id === "pi_down") throw new Error("No such payment_intent");
        return { status: "canceled", livemode };
      },
      async cancelPaymentIntent() {
        throw new Error("cancel was not expected");
      },
    }),
    async (jobId) => {
      released.push(jobId);
      return true;
    },
  );
  assert.deepEqual(outcomes, ["stripe_failed", "released"]);
  assert.deepEqual(released, ["job-next"]);
});
