import assert from "node:assert/strict";
import test from "node:test";
import { missingProofWarning, proofAfterSave, proofStageForStep, proofTapAction } from "./proof-warning";

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

const arrived = {
  service: "delivery",
  status: "arrived",
  nextStatus: "item_check",
  hasPickup: false,
  hasDropoff: false,
  needsReceipt: false,
  hasReceipt: false,
};

test("item loaded saves a pickup photo and then advances", () => {
  assert.equal(proofStageForStep(arrived), "pickup");
  assert.equal(proofAfterSave(arrived, "pickup"), null);
  assert.equal(proofTapAction({ busy: false, needsProof: true, hasFile: true }), "save");
  assert.equal(proofTapAction({ busy: false, needsProof: true, hasFile: false }), "warn");
  assert.equal(proofTapAction({ busy: true, needsProof: true, hasFile: true }), "ignore");
  assert.equal(proofTapAction({ busy: false, needsProof: false, hasFile: false }), "advance");
});

test("a failed save can be tried again, and a saved pickup is not uploaded twice", () => {
  assert.equal(proofTapAction({ busy: false, needsProof: true, hasFile: true }), "save");
  assert.equal(proofStageForStep({ ...arrived, hasPickup: true }), null);
  assert.equal(proofTapAction({ busy: false, needsProof: false, hasFile: true }), "advance");
});

test("delivered saves the drop-off photo before the job advances", () => {
  assert.equal(proofStageForStep(open), "dropoff");
  assert.equal(proofAfterSave(open, "dropoff"), null);
  const withReceipt = { ...open, needsReceipt: true };
  assert.equal(proofStageForStep(withReceipt), "dropoff");
  assert.match(proofAfterSave(withReceipt, "dropoff") ?? "", /disposal receipt/);
  assert.equal(proofStageForStep({ ...withReceipt, hasDropoff: true }), "dump_receipt");
  assert.equal(proofAfterSave({ ...withReceipt, hasDropoff: true }, "dump_receipt"), null);
});
