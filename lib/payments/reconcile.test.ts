import assert from "node:assert/strict";
import test from "node:test";
import { reconcilePaymentAction } from "./reconcile";

test("a live PaymentIntent is left alone", () => {
  assert.equal(
    reconcilePaymentAction({
      livemode: true,
      intentStatus: "requires_capture",
      jobStatus: "assigned",
      paymentStatus: "awaiting_payment",
    }),
    "skip",
  );
});

test("a missed test hold uses the same authorization function as the webhook", () => {
  assert.equal(
    reconcilePaymentAction({
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
    reconcilePaymentAction({
      livemode: false,
      intentStatus: "requires_capture",
      jobStatus: "arrived",
      paymentStatus: "authorized",
    }),
    "skip",
  );
});

test("a canceled hold that was stored is noted, and one that was never stored is only recorded", () => {
  assert.equal(
    reconcilePaymentAction({
      livemode: false,
      intentStatus: "canceled",
      jobStatus: "assigned",
      paymentStatus: "authorized",
    }),
    "note_canceled",
  );
  assert.equal(
    reconcilePaymentAction({
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
    reconcilePaymentAction({
      livemode: false,
      intentStatus: "succeeded",
      jobStatus: "delivered",
      paymentStatus: "authorized",
    }),
    "skip",
  );
});
