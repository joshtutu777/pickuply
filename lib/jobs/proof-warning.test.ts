import assert from "node:assert/strict";
import test from "node:test";
import { missingProofWarning } from "./proof-warning";

const open = {
  service: "delivery",
  status: "in_transit",
  nextStatus: "delivered",
  hasPickup: true,
  hasDropoff: false,
  needsReceipt: false,
  hasReceipt: false,
};

test("a delivery without proof names the missing photo or video", () => {
  assert.equal(
    missingProofWarning(open),
    "Please upload a delivery photo or video before marking this job as Delivered.",
  );
  assert.equal(missingProofWarning({ ...open, hasDropoff: true }), null);
});

test("pickup and junk removal use their own proof warnings", () => {
  assert.match(
    missingProofWarning({ ...open, status: "arrived", nextStatus: "item_check", hasPickup: false }) ?? "",
    /pickup photo or video/,
  );
  assert.match(
    missingProofWarning({
      ...open,
      service: "junk",
      status: "arrived",
      nextStatus: "delivered",
      hasPickup: false,
    }) ?? "",
    /Junk removed/,
  );
  assert.match(
    missingProofWarning({
      ...open,
      service: "junk",
      status: "arrived",
      nextStatus: "delivered",
      hasPickup: true,
      needsReceipt: true,
    }) ?? "",
    /disposal receipt/,
  );
});
