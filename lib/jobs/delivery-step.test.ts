import assert from "node:assert/strict";
import test from "node:test";
import { advanceErrorCode } from "./delivery-step";
import { nextDriverAction } from "./tracker";

test("a missing delivery photo is not reported as a skipped step", () => {
  assert.equal(advanceErrorCode("add the delivery photo first"), "dropoff");
  assert.equal(advanceErrorCode("add the pickup photo first"), "pickup");
  assert.equal(advanceErrorCode("add the disposal receipt first"), "receipt");
  assert.equal(advanceErrorCode("that step is not available"), "step");
  assert.equal(advanceErrorCode("payment must be authorized before work starts"), "payment");
});

test("delivered is the button only after the driver has arrived at the drop-off", () => {
  const heading = nextDriverAction({
    status: "in_transit",
    paymentStatus: "authorized",
    service: "delivery",
    dropoffArrived: false,
  });
  assert.equal(heading.label, "Arrived at drop-off");
  assert.equal(heading.nextStatus, "at_dropoff");

  const delivered = nextDriverAction({
    status: "in_transit",
    paymentStatus: "authorized",
    service: "delivery",
    dropoffArrived: true,
  });
  assert.equal(delivered.label, "Delivered");
  assert.equal(delivered.nextStatus, "delivered");

  const loaded = nextDriverAction({
    status: "item_check",
    paymentStatus: "authorized",
    service: "delivery",
  });
  assert.equal(loaded.label, "Proceed to drop-off");
  assert.equal(loaded.nextStatus, "in_transit");

  const expired = nextDriverAction({
    status: "item_check",
    paymentStatus: "authorized",
    service: "delivery",
    reviewExpired: true,
  });
  assert.equal(expired.label, "Proceed to drop-off");
  assert.equal(expired.nextStatus, "in_transit");

  const awaiting = nextDriverAction({
    status: "delivered",
    paymentStatus: "authorized",
    service: "delivery",
    dropoffArrived: true,
  });
  assert.equal(awaiting.label, "Awaiting customer confirmation");
  assert.equal(awaiting.waiting, "Awaiting customer confirmation");
  assert.equal(awaiting.nextStatus, null);

  const complete = nextDriverAction({
    status: "completed",
    paymentStatus: "captured",
    service: "delivery",
    dropoffArrived: true,
  });
  assert.equal(complete.label, "Delivery complete");
  assert.equal(complete.waiting, null);
  assert.equal(complete.nextStatus, null);
});
