import assert from "node:assert/strict";
import test from "node:test";
import { reconcilePaymentAction, type ReconcileAction } from "./reconcile";

const open = {
  paymentDueAt: "2026-10-29T03:00:00.000Z",
  now: "2026-10-29T02:00:00.000Z",
};

function decide(input: {
  livemode: boolean;
  intentStatus: string;
  jobStatus: string;
  paymentStatus: string;
  paymentDueAt?: string | null;
  now?: string;
}): ReconcileAction {
  return reconcilePaymentAction({
    paymentDueAt: open.paymentDueAt,
    now: open.now,
    ...input,
  });
}

test("a live PaymentIntent is reported and left unchanged while the switch is test", () => {
  assert.equal(
    decide({
      livemode: true,
      intentStatus: "requires_capture",
      jobStatus: "assigned",
      paymentStatus: "awaiting_payment",
    }),
    "report_mismatch",
  );
});

test("a missed test hold uses the same authorization function as the webhook", () => {
  assert.equal(
    decide({
      livemode: false,
      intentStatus: "requires_capture",
      jobStatus: "assigned",
      paymentStatus: "awaiting_payment",
    }),
    "authorize",
  );
});

test("a hold that was already stored is not authorized again from a later job step", () => {
  assert.equal(
    decide({
      livemode: false,
      intentStatus: "requires_capture",
      jobStatus: "arrived",
      paymentStatus: "authorized",
    }),
    "skip",
  );
});

test("a canceled or expired booking is not authorized from a capturable PaymentIntent", () => {
  assert.equal(
    decide({
      livemode: false,
      intentStatus: "requires_capture",
      jobStatus: "cancelled",
      paymentStatus: "awaiting_payment",
    }),
    "skip_closed",
  );
  assert.equal(
    decide({
      livemode: false,
      intentStatus: "requires_capture",
      jobStatus: "assigned",
      paymentStatus: "canceled",
    }),
    "skip_closed",
  );
  assert.equal(
    decide({
      livemode: false,
      intentStatus: "requires_capture",
      jobStatus: "assigned",
      paymentStatus: "awaiting_payment",
      paymentDueAt: "2026-10-29T01:00:00.000Z",
      now: "2026-10-29T02:00:00.000Z",
    }),
    "skip_closed",
  );
});

test("a canceled hold that was stored is noted, and one that was never stored is only recorded", () => {
  assert.equal(
    decide({
      livemode: false,
      intentStatus: "canceled",
      jobStatus: "assigned",
      paymentStatus: "authorized",
    }),
    "note_canceled",
  );
  assert.equal(
    decide({
      livemode: false,
      intentStatus: "canceled",
      jobStatus: "assigned",
      paymentStatus: "awaiting_payment",
    }),
    "record_unpaid_cancel",
  );
});

test("the reconciler does not capture a succeeded PaymentIntent", () => {
  assert.equal(
    decide({
      livemode: false,
      intentStatus: "succeeded",
      jobStatus: "delivered",
      paymentStatus: "authorized",
    }),
    "skip",
  );
});
