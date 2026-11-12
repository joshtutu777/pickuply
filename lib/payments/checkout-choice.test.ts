import assert from "node:assert/strict";
import test from "node:test";
import { chooseAuthorization, type CheckoutIntentChoice } from "./checkout-choice";

const job = { priceCents: 5250, driverId: "driver-1" };

function intent(overrides: Partial<CheckoutIntentChoice> = {}): CheckoutIntentChoice {
  return {
    id: "pi_authorized1",
    status: "requires_capture",
    amount: 5250,
    driverId: "driver-1",
    created: 10,
    livemode: false,
    ...overrides,
  };
}

test("an authorized test hold for this driver and total is the one to record", () => {
  assert.deepEqual(chooseAuthorization({ ...job, intents: [intent()] }), {
    acceptId: "pi_authorized1",
    cancelIds: [],
  });
});

test("a return without a matching authorization records nothing", () => {
  assert.deepEqual(
    chooseAuthorization({
      ...job,
      intents: [intent({ status: "processing" }), intent({ id: "pi_failed1", status: "requires_payment_method" })],
    }),
    { acceptId: null, cancelIds: [] },
  );
});

test("a declined or abandoned card is not treated as paid", () => {
  assert.equal(
    chooseAuthorization({
      ...job,
      intents: [
        intent({ id: "pi_failed1", status: "requires_payment_method" }),
        intent({ id: "pi_canceled1", status: "canceled" }),
      ],
    }).acceptId,
    null,
  );
});

test("repeated holds keep the earliest match and name the rest for release", () => {
  const choice = chooseAuthorization({
    ...job,
    intents: [
      intent({ id: "pi_second", created: 20 }),
      intent({ id: "pi_first", created: 10 }),
      intent({ id: "pi_wrongamount", amount: 1000, created: 5 }),
      intent({ id: "pi_livedata", livemode: true, created: 1 }),
      intent({ id: "pi_otherdriver", driverId: "driver-2", created: 2 }),
    ],
  });
  assert.deepEqual(choice, { acceptId: "pi_first", cancelIds: ["pi_second"] });
});
