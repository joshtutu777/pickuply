import assert from "node:assert/strict";
import test from "node:test";
import { offerCountCopy } from "./offer-counts";

test("an open request with no active offers is waiting", () => {
  assert.deepEqual(offerCountCopy(0, 0, "open"), {
    waiting: true,
    received: null,
    unseen: null,
  });
});

test("active offers keep a separate new count", () => {
  assert.deepEqual(offerCountCopy(2, 1, "open"), {
    waiting: false,
    received: "2 Offers Received",
    unseen: "1 New Offer",
  });
  assert.equal(offerCountCopy(1, 0, "open").received, "1 Offer Received");
  assert.equal(offerCountCopy(1, 0, "open").unseen, "0 New Offers");
});

test("a finished request does not say it is waiting", () => {
  assert.deepEqual(offerCountCopy(0, 0, "completed"), {
    waiting: false,
    received: null,
    unseen: null,
  });
});
