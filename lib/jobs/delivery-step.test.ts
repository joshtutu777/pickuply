import assert from "node:assert/strict";
import test from "node:test";
import { advanceErrorCode } from "./delivery-step";
import { nextDriverAction } from "./tracker";

test("a missing delivery photo is not reported as a skipped step", () => {
  assert.equal(advanceErrorCode("add the delivery photo first"), "photo");
  assert.equal(advanceErrorCode("add the pickup photo first"), "photo");
  assert.equal(advanceErrorCode("add the disposal receipt first"), "photo");
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

  const waiting = nextDriverAction({
    status: "item_check",
    paymentStatus: "authorized",
    service: "delivery",
  });
  assert.equal(waiting.nextStatus, null);

  const expired = nextDriverAction({
    status: "item_check",
    paymentStatus: "authorized",
    service: "delivery",
    reviewExpired: true,
  });
  assert.equal(expired.label, "Arrived at drop-off");
  assert.equal(expired.nextStatus, "at_dropoff");

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
