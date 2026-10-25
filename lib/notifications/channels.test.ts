import assert from "node:assert/strict";
import test from "node:test";
import { channelPlan, externalDeliveryAllowed } from "./channels";

const base = {
  platformSms: false,
  pushEnabled: true,
  emailEnabled: true,
  smsEnabled: false,
  hasSubscription: true,
  hasEmail: true,
  hasPhone: true,
  hasPushKey: true,
  hasEmailKey: true,
  hasSmsKey: true,
  hasConsent: true,
  pushSent: false,
  emailSent: false,
  smsSent: false,
};

test("texting stays off while the platform switch is off", () => {
  const plan = channelPlan({ ...base, smsEnabled: true });
  assert.equal(plan.sms, "skip");
  assert.equal(plan.push, "send");
  assert.equal(plan.email, "send");
});

test("a missing email key waits instead of marking the alert sent", () => {
  const plan = channelPlan({ ...base, hasEmailKey: false });
  assert.equal(plan.email, "wait");
});

test("optional texts stay off without consent", () => {
  const plan = channelPlan({ ...base, platformSms: true, smsEnabled: true, hasConsent: false });
  assert.equal(plan.sms, "skip");
});

test("a test account does not get an external alert", () => {
  assert.equal(externalDeliveryAllowed(true), false);
  assert.equal(externalDeliveryAllowed(false), true);
});

test("push is skipped when the person turned it off", () => {
  const plan = channelPlan({ ...base, pushEnabled: false });
  assert.equal(plan.push, "skip");
});
