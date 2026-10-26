import assert from "node:assert/strict";
import test from "node:test";
import { offerMaySubmit, showOfflineOfferNotice } from "./offer-gate";

test("an offline approved driver sees the notice and cannot submit", () => {
  assert.equal(showOfflineOfferNotice({ online: false, approved: true }), true);
  assert.equal(offerMaySubmit({ online: false, approved: true, vehicleOk: true }), false);
});

test("going online does not submit by itself", () => {
  assert.equal(offerMaySubmit({ online: true, approved: true, vehicleOk: true }), true);
  assert.equal(showOfflineOfferNotice({ online: true, approved: true }), false);
});

test("an unapproved driver does not get a Go Online bypass", () => {
  assert.equal(showOfflineOfferNotice({ online: false, approved: false }), false);
  assert.equal(offerMaySubmit({ online: true, approved: false, vehicleOk: true }), false);
});

test("a mismatched vehicle stays blocked after the driver is online", () => {
  assert.equal(offerMaySubmit({ online: true, approved: true, vehicleOk: false }), false);
});
