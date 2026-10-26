import assert from "node:assert/strict";
import test from "node:test";
import { alertAllowed, claimAlert, defaultAlertPrefs, shouldPlaySound } from "./live-alert";

test("a new job alert follows the job switch", () => {
  assert.equal(alertAllowed("new_job", defaultAlertPrefs), true);
  assert.equal(alertAllowed("new_job", { ...defaultAlertPrefs, newJobs: false }), false);
});

test("messages and delivery updates have their own switches", () => {
  assert.equal(alertAllowed("new_message", { ...defaultAlertPrefs, messages: false }), false);
  assert.equal(alertAllowed("delivered", { ...defaultAlertPrefs, delivery: false }), false);
  assert.equal(alertAllowed("payment_confirmed", { ...defaultAlertPrefs, delivery: false }), false);
});

test("an unknown alert still shows", () => {
  assert.equal(alertAllowed("admin_note", { ...defaultAlertPrefs, newJobs: false, messages: false, delivery: false }), true);
});

test("sound plays once, only while the app is visible and sound is on", () => {
  assert.equal(shouldPlaySound({ allowed: true, soundOn: true, visible: true }), true);
  assert.equal(shouldPlaySound({ allowed: true, soundOn: false, visible: true }), false);
  assert.equal(shouldPlaySound({ allowed: true, soundOn: true, visible: false }), false);
  const seen = new Set<string>();
  assert.equal(claimAlert("n1", seen), true);
  assert.equal(claimAlert("n1", seen), false);
});
