import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { takenJobMessage } from "../jobs/taken-message";
import { stripeEnvForMode } from "./payments-mode";
import {
  PAID_BOOKINGS_UNAVAILABLE,
  liveCustomerChargesPaused,
  newLiveChargeDecision,
  paidBookingsEnabled,
  placeCustomerCharge,
} from "./paid-bookings";

const closed = [undefined, "", "false", "FALSE", "yes", "1", "true ", " true"] as const;

test("missing or invalid values keep paid bookings closed", () => {
  for (const value of closed) {
    assert.equal(paidBookingsEnabled(value), false, JSON.stringify(value));
    assert.equal(newLiveChargeDecision({ paymentsMode: "live", paidBookings: value, kind: "booking" }), "block");
    assert.equal(newLiveChargeDecision({ paymentsMode: "live", paidBookings: value, kind: "tip" }), "block");
  }
  assert.equal(paidBookingsEnabled("true"), true);
});

test("a closed gate blocks a live charge before Stripe is called", async () => {
  let calls = 0;
  const create = async () => {
    calls += 1;
    return { id: "cs_live_should_not_exist", livemode: true };
  };
  for (const paidBookings of [undefined, "", "false", "no"]) {
    await assert.rejects(
      () =>
        placeCustomerCharge({
          paymentsMode: "live",
          paidBookings,
          kind: "booking",
          create,
        }),
      { message: PAID_BOOKINGS_UNAVAILABLE },
    );
    await assert.rejects(
      () =>
        placeCustomerCharge({
          paymentsMode: "live",
          paidBookings,
          kind: "tip",
          create,
        }),
      { message: PAID_BOOKINGS_UNAVAILABLE },
    );
  }
  assert.equal(calls, 0);
});

test("a second request cannot bypass a closed gate", async () => {
  let calls = 0;
  const create = async () => {
    calls += 1;
    throw new Error("Stripe was called");
  };
  const input = {
    paymentsMode: "live" as const,
    paidBookings: "false",
    kind: "booking" as const,
    create,
  };
  await assert.rejects(() => placeCustomerCharge(input), { message: PAID_BOOKINGS_UNAVAILABLE });
  await assert.rejects(() => placeCustomerCharge({ ...input, kind: "tip" }), { message: PAID_BOOKINGS_UNAVAILABLE });
  assert.equal(calls, 0);
});

test("test customer and test driver profiles cannot bypass a closed live gate", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      placeCustomerCharge({
        paymentsMode: "live",
        paidBookings: undefined,
        kind: "booking",
        isTestCustomer: true,
        isTestDriver: true,
        create: async () => {
          calls += 1;
          return { id: "cs_live_bypass" };
        },
      }),
    { message: PAID_BOOKINGS_UNAVAILABLE },
  );
  await assert.rejects(
    () =>
      placeCustomerCharge({
        paymentsMode: "live",
        paidBookings: "false",
        kind: "tip",
        isTestCustomer: true,
        isTestDriver: false,
        create: async () => {
          calls += 1;
          return { id: "pi_live_bypass" };
        },
      }),
    { message: PAID_BOOKINGS_UNAVAILABLE },
  );
  assert.equal(
    newLiveChargeDecision({
      paymentsMode: "live",
      paidBookings: "false",
      kind: "booking",
      isTestCustomer: false,
      isTestDriver: true,
    }),
    "block",
  );
  assert.equal(calls, 0);
});

test("an open gate still refuses a charge when an existing validation fails", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      placeCustomerCharge({
        paymentsMode: "live",
        paidBookings: "true",
        kind: "booking",
        isTestCustomer: true,
        validationError: "the price breakdown does not add up",
        create: async () => {
          calls += 1;
          return { id: "cs_live_invalid" };
        },
      }),
    { message: "the price breakdown does not add up" },
  );
  assert.equal(calls, 0);
});

test("an open gate permits a live charge only after validation passes", async () => {
  let calls = 0;
  const created = await placeCustomerCharge({
    paymentsMode: "live",
    paidBookings: "true",
    kind: "tip",
    validationError: null,
    create: async () => {
      calls += 1;
      return { id: "pi_live_ok", livemode: true };
    },
  });
  assert.equal(calls, 1);
  assert.equal(created.livemode, true);
  assert.equal(newLiveChargeDecision({ paymentsMode: "live", paidBookings: "true", kind: "booking" }), "allow");
});

test("test mode can create a test charge while the live gate is closed", async () => {
  let calls = 0;
  const created = await placeCustomerCharge({
    paymentsMode: "test",
    paidBookings: undefined,
    kind: "booking",
    isTestCustomer: true,
    create: async () => {
      calls += 1;
      return { id: "cs_test_local", livemode: false };
    },
  });
  assert.equal(calls, 1);
  assert.equal(created.id, "cs_test_local");
  assert.equal(created.livemode, false);
  assert.equal(liveCustomerChargesPaused("test", undefined), false);
  assert.equal(liveCustomerChargesPaused("live", undefined), true);
  assert.equal(liveCustomerChargesPaused("live", "false"), true);
  assert.equal(liveCustomerChargesPaused("live", "true"), false);
});

test("the gate does not change Stripe key selection", () => {
  const env = {
    STRIPE_SECRET_KEY: "sk_test_current",
    STRIPE_LIVE_SECRET_KEY: "sk_live_saved",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_current",
    NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY: "pk_live_saved",
  };
  assert.equal(stripeEnvForMode("live", env).secret, "sk_live_saved");
  assert.equal(stripeEnvForMode("test", env).secret, "sk_test_current");
  assert.equal(paidBookingsEnabled("false"), false);
});

test("the customer sees the paused message unchanged", () => {
  assert.equal(takenJobMessage(PAID_BOOKINGS_UNAVAILABLE), PAID_BOOKINGS_UNAVAILABLE);
});

test("captures, refunds, deadlines, and reconciliation do not use the paid-booking gate", () => {
  const files = [
    "capture.ts",
    "refunds.ts",
    "deadline.ts",
    "reconcile-run.ts",
    "platform-events.ts",
    "transfers.ts",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.equal(source.includes("paid-bookings"), false, file);
    assert.equal(source.includes("PAID_BOOKINGS_ENABLED"), false, file);
  }
});

test("booking and tip creation call the gate before a Stripe create", () => {
  const booking = readFileSync(new URL("../../app/jobs/pay/actions.ts", import.meta.url), "utf8");
  const tip = readFileSync(new URL("../../app/jobs/tip-actions.ts", import.meta.url), "utf8");
  const savedTip = readFileSync(new URL("./tip-charge.ts", import.meta.url), "utf8");
  assert.ok(booking.indexOf("liveCustomerChargesPaused") < booking.indexOf("checkout.sessions.create"));
  assert.ok(booking.indexOf("placeCustomerCharge") < booking.indexOf("checkout.sessions.create"));
  assert.ok(tip.indexOf("liveCustomerChargesPaused") < tip.indexOf("checkout.sessions.create"));
  assert.ok(tip.indexOf("placeCustomerCharge") < tip.indexOf("checkout.sessions.create"));
  assert.ok(savedTip.indexOf("placeCustomerCharge") < savedTip.indexOf("paymentIntents.create"));
});
