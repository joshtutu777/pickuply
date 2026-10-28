import assert from "node:assert/strict";
import test from "node:test";
import { stripeModeProblem } from "../stripe-mode";
import {
  bookingCheckoutCustomer,
  cardSaveDisclosure,
  decideTipCharge,
  sameBookingCard,
  savedTipCharge,
  tipFallbackAllowed,
  tipIdempotencyKey,
  tipOneTapQuestion,
} from "./saved-card";

test("booking checkout always saves the card for a later tip", () => {
  assert.deepEqual(bookingCheckoutCustomer(null), {
    customer_creation: "always",
    setup_future_usage: "off_session",
  });
  assert.deepEqual(bookingCheckoutCustomer("not-a-customer"), {
    customer_creation: "always",
    setup_future_usage: "off_session",
  });
  assert.deepEqual(bookingCheckoutCustomer("cus_test123"), {
    customer: "cus_test123",
    setup_future_usage: "off_session",
  });
});

test("a tip names the booking card and does not ask for it again", () => {
  assert.equal(
    tipOneTapQuestion({
      amountCents: 1000,
      driverFirstName: "Marcus",
      brand: "visa",
      last4: "4242",
    }),
    "Tip $10 to Marcus with Visa •••• 4242?",
  );
  assert.equal(
    tipOneTapQuestion({ amountCents: 500, driverFirstName: "Marcus", brand: "visa", last4: null }),
    null,
  );
});

test("a removed card or a different card falls back to checkout", () => {
  const booking = {
    intentCustomerId: "cus_test123",
    intentPaymentMethodId: "pm_card4242",
    savedCustomerId: "cus_test123",
    savedPaymentMethodId: "pm_card4242",
    detached: false,
  };
  assert.equal(sameBookingCard(booking), true);
  assert.equal(sameBookingCard({ ...booking, detached: true }), false);
  assert.equal(sameBookingCard({ ...booking, savedPaymentMethodId: "pm_other" }), false);
  assert.equal(sameBookingCard({ ...booking, intentCustomerId: null, intentPaymentMethodId: null }), false);
});

test("each job tip is charged once", () => {
  const jobId = "11111111-1111-4111-8111-111111111111";
  const tipId = "22222222-2222-4222-8222-222222222222";
  assert.equal(tipIdempotencyKey(jobId, tipId), `tip:${jobId}:${tipId}`);
  assert.equal(tipIdempotencyKey(jobId, tipId), tipIdempotencyKey(jobId, tipId));
});

test("a tip charges the booking card once and does not ask for it again", () => {
  const jobId = "11111111-1111-4111-8111-111111111111";
  const tipId = "22222222-2222-4222-8222-222222222222";
  const charge = savedTipCharge({
    tipId,
    amountCents: 1000,
    customerId: "cus_test123",
    paymentMethodId: "pm_card4242",
    jobId,
    driverId: "driver-1",
  });
  assert.equal(charge.payment_method, "pm_card4242");
  assert.equal(charge.customer, "cus_test123");
  assert.equal(charge.off_session, true);
  assert.equal(charge.confirm, true);
  assert.equal(charge.amount, 1000);
  assert.equal(charge.idempotencyKey, tipIdempotencyKey(jobId, tipId));
  assert.deepEqual(savedTipCharge({
    tipId,
    amountCents: 1000,
    customerId: "cus_test123",
    paymentMethodId: "pm_card4242",
    jobId,
    driverId: "driver-1",
  }).idempotencyKey, charge.idempotencyKey);
  assert.equal(decideTipCharge({ status: "succeeded", livemode: false }), "paid");
});

test("authentication or a declined card falls back, and a live card is refused", () => {
  assert.equal(decideTipCharge({ errorCode: "authentication_required", status: "requires_action" }), "authenticate");
  assert.equal(decideTipCharge({ errorCode: "card_declined", errorType: "card_error" }), "fallback");
  assert.equal(decideTipCharge({ errorType: "api_connection_error" }), "uncertain");
  assert.equal(decideTipCharge({ livemode: true, status: "succeeded" }), "live");
  assert.equal(stripeModeProblem("sk_live_123", "pk_live_123"), "Live payments are not enabled.");
  assert.equal(stripeModeProblem("sk_test_123", "pk_test_123"), null);
  assert.equal(tipFallbackAllowed("canceled"), true);
  assert.equal(tipFallbackAllowed("paid"), false);
  assert.equal(tipFallbackAllowed("blocked"), false);
});

test("the booking page and the receipt use the same card disclosure", () => {
  assert.match(cardSaveDisclosure, /held for this booking/);
  assert.match(cardSaveDisclosure, /one tap/);
  assert.match(cardSaveDisclosure, /won't be charged extra without your OK/);
});
