import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PAID_BOOKINGS_UNAVAILABLE, placeCustomerCharge } from "./paid-bookings";
import {
  livePilotEnabled,
  livePilotLabel,
  onePilotId,
  pilotAllowsTip,
  pilotCheckoutAction,
  type PilotBookingFacts,
} from "./live-pilot";

const customer = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const job = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const now = Date.parse("2026-11-03T18:00:00.000Z");

function approved(): PilotBookingFacts {
  return {
    pilotEnabled: "true",
    allowCustomerId: customer,
    allowJobId: job,
    authenticatedCustomerId: customer,
    jobId: job,
    jobCustomerId: customer,
    jobIsTest: false,
    customerIsTest: false,
    driverIsTest: false,
    driverStatus: "active",
    drivingStopped: false,
    livePayoutsEnabled: true,
    liveTransfersActive: true,
    liveDetailsSubmitted: true,
    jobStatus: "assigned",
    paymentStatus: "awaiting_payment",
    paymentDueAt: "2026-11-03T19:00:00.000Z",
    priceCents: 5250,
    priceAddsUp: true,
    paymentOnHold: false,
    hasSuccessfulPayment: false,
    hasActiveCheckout: false,
    now,
  };
}

test("a closed pilot switch and a missing allowlist stay closed", () => {
  for (const value of [undefined, "", "false", "TRUE", "yes", "1"]) {
    assert.equal(livePilotEnabled(value), false, JSON.stringify(value));
    assert.equal(pilotCheckoutAction({ ...approved(), pilotEnabled: value }), "block");
  }
  assert.equal(pilotCheckoutAction({ ...approved(), allowCustomerId: undefined, allowJobId: undefined }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), allowCustomerId: "", allowJobId: "" }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), allowCustomerId: "*", allowJobId: "*" }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), allowCustomerId: "all", allowJobId: "all" }), "block");
  assert.equal(
    pilotCheckoutAction({ ...approved(), allowCustomerId: `${customer},${other}`, allowJobId: job }),
    "block",
  );
  assert.equal(onePilotId("*"), null);
  assert.equal(onePilotId(""), null);
  assert.equal(onePilotId("all"), null);
  assert.equal(livePilotLabel({ LIVE_PILOT_ENABLED: "false" }), "off");
  assert.equal(livePilotLabel({ LIVE_PILOT_ENABLED: "true" }), "off");
});

test("the wrong customer or the wrong job is blocked", () => {
  assert.equal(pilotCheckoutAction({ ...approved(), authenticatedCustomerId: other }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), jobCustomerId: other }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), jobId: other }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), allowJobId: other }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), authenticatedCustomerId: null }), "block");
});

test("a test job, test customer, or test driver is blocked", () => {
  assert.equal(pilotCheckoutAction({ ...approved(), jobIsTest: true }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), customerIsTest: true }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), driverIsTest: true }), "block");
});

test("an unapproved driver or a driver without live payouts is blocked", () => {
  for (const status of ["applied", "pending_review", "paused", "removed", null]) {
    assert.equal(pilotCheckoutAction({ ...approved(), driverStatus: status }), "block", String(status));
  }
  assert.equal(pilotCheckoutAction({ ...approved(), drivingStopped: true }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), livePayoutsEnabled: false }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), liveTransfersActive: false }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), liveDetailsSubmitted: false }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), driverStatus: "approved_new" }), "create");
});

test("the job must be waiting for payment and must not already be paid", () => {
  assert.equal(pilotCheckoutAction({ ...approved(), jobStatus: "open" }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), paymentStatus: "authorized" }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), hasSuccessfulPayment: true }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), paymentDueAt: "2026-11-03T17:00:00.000Z" }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), priceAddsUp: false }), "block");
  assert.equal(pilotCheckoutAction({ ...approved(), paymentOnHold: true }), "block");
});

test("an approved booking can be created only after the existing validation passes", async () => {
  assert.equal(pilotCheckoutAction(approved()), "create");
  let calls = 0;
  const create = async () => {
    calls += 1;
    return { id: "cs_live_pilot", livemode: true };
  };
  await assert.rejects(
    () =>
      placeCustomerCharge({
        paymentsMode: "live",
        paidBookings: "false",
        kind: "booking",
        pilotAllowed: true,
        validationError: "the price breakdown does not add up",
        create,
      }),
    { message: "the price breakdown does not add up" },
  );
  assert.equal(calls, 0);
  const created = await placeCustomerCharge({
    paymentsMode: "live",
    paidBookings: "false",
    kind: "booking",
    pilotAllowed: true,
    validationError: null,
    create,
  });
  assert.equal(calls, 1);
  assert.equal(created.id, "cs_live_pilot");
});

test("a second checkout does not create another payment", async () => {
  assert.equal(pilotCheckoutAction({ ...approved(), hasActiveCheckout: true }), "resume");
  let calls = 0;
  await assert.rejects(
    () =>
      placeCustomerCharge({
        paymentsMode: "live",
        paidBookings: "false",
        kind: "booking",
        pilotAllowed: false,
        create: async () => {
          calls += 1;
          return { id: "cs_live_second" };
        },
      }),
    { message: PAID_BOOKINGS_UNAVAILABLE },
  );
  assert.equal(calls, 0);
});

test("pilot approval does not open a tip or another booking", async () => {
  assert.equal(pilotAllowsTip(), false);
  let calls = 0;
  const create = async () => {
    calls += 1;
    return { id: "pi_live_tip" };
  };
  await assert.rejects(
    () =>
      placeCustomerCharge({
        paymentsMode: "live",
        paidBookings: "false",
        kind: "tip",
        pilotAllowed: true,
        create,
      }),
    { message: PAID_BOOKINGS_UNAVAILABLE },
  );
  assert.equal(pilotCheckoutAction({ ...approved(), jobId: other }), "block");
  assert.equal(calls, 0);
});

test("the global gate stays closed when the pilot is off, before Stripe is called", async () => {
  assert.equal(pilotCheckoutAction({ ...approved(), pilotEnabled: "false" }), "block");
  let calls = 0;
  await assert.rejects(
    () =>
      placeCustomerCharge({
        paymentsMode: "live",
        paidBookings: "false",
        kind: "booking",
        create: async () => {
          calls += 1;
          return { id: "cs_live_closed" };
        },
      }),
    { message: PAID_BOOKINGS_UNAVAILABLE },
  );
  assert.equal(calls, 0);
});

test("a test profile cannot use the pilot flag to open a live charge", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      placeCustomerCharge({
        paymentsMode: "live",
        paidBookings: "false",
        kind: "booking",
        pilotAllowed: true,
        isTestCustomer: true,
        isTestDriver: true,
        create: async () => {
          calls += 1;
          return { id: "cs_live_test_profile" };
        },
      }),
    { message: PAID_BOOKINGS_UNAVAILABLE },
  );
  assert.equal(calls, 0);
});

test("turning the pilot off blocks a new checkout and leaves settlement alone", () => {
  assert.equal(pilotCheckoutAction({ ...approved(), pilotEnabled: undefined }), "block");
  const files = ["capture.ts", "refunds.ts", "deadline.ts", "reconcile-run.ts", "platform-events.ts", "transfers.ts"];
  for (const file of files) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.equal(source.includes("live-pilot"), false, file);
    assert.equal(source.includes("pilot-access"), false, file);
  }
});

test("checkout reads the pilot on the server and tips do not", () => {
  const booking = readFileSync(new URL("../../app/jobs/pay/actions.ts", import.meta.url), "utf8");
  const tip = readFileSync(new URL("../../app/jobs/tip-actions.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../app/jobs/[id]/page.tsx", import.meta.url), "utf8");
  assert.ok(booking.indexOf("loadPilotCheckout") < booking.indexOf("checkout.sessions.create"));
  assert.equal(booking.includes("LIVE_PILOT_CUSTOMER_ID"), false);
  assert.equal(booking.includes("searchParams"), false);
  assert.equal(tip.includes("loadPilotCheckout"), false);
  assert.equal(tip.includes("pilotAllowed"), false);
  assert.equal(page.includes("LIVE_PILOT_CUSTOMER_ID"), false);
  assert.equal(livePilotLabel({
    LIVE_PILOT_ENABLED: "true",
    LIVE_PILOT_CUSTOMER_ID: customer,
    LIVE_PILOT_JOB_ID: job,
  }), "one booking");
});
