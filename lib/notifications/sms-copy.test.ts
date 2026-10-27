import assert from "node:assert/strict";
import test from "node:test";
import { channelPlan } from "./channels";
import { pilotSmsKinds, pilotSmsText } from "./sms-copy";

const phone = "+15555550100";

function assertSafe(text: string) {
  assert.equal(text.startsWith("Pickuply: "), true);
  assert.equal(text.length <= 160, true);
  assert.equal(text.includes(phone), false);
  assert.equal(text.includes("@"), false);
  assert.equal(/\d{3,}/.test(text), false);
  assert.equal(/street|avenue|apt\b/i.test(text), false);
}

test("the eight pilot texts stay short and leave out private details", () => {
  const samples = [
    pilotSmsText({ kind: "new_job", service: "delivery", jobStatus: "open", area: "Atlanta" }),
    pilotSmsText({ kind: "new_job", service: "junk", jobStatus: "open", area: "123 Main Street" }),
    pilotSmsText({ kind: "offer", jobStatus: "open" }),
    pilotSmsText({ kind: "assigned", jobStatus: "assigned" }),
    pilotSmsText({ kind: "driver_confirmed", jobStatus: "assigned" }),
    pilotSmsText({ kind: "en_route", jobStatus: "en_route" }),
    pilotSmsText({ kind: "arrived", jobStatus: "arrived" }),
    pilotSmsText({ kind: "delivered", jobStatus: "delivered", service: "delivery" }),
    pilotSmsText({ kind: "delivered", jobStatus: "delivered", service: "junk" }),
    pilotSmsText({ kind: "driver_approved", driverStatus: "approved_new" }),
  ];
  assert.equal(samples.every((item) => item != null), true);
  for (const text of samples) assertSafe(text ?? "");
  assert.equal(samples[1]?.includes("your area"), true);
  assert.equal(samples[9]?.includes("accepting jobs"), false);
  assert.equal(samples[9]?.toLowerCase().includes("online"), false);
});

test("only the selected driver and the owning customer get the acceptance texts", () => {
  assert.equal(pilotSmsText({ kind: "assigned", jobStatus: "assigned" })?.includes("offer was accepted"), true);
  assert.equal(pilotSmsText({ kind: "driver_confirmed", jobStatus: "assigned" })?.includes("driver is confirmed"), true);
  assert.equal(pilotSmsText({ kind: "new_job", service: "delivery", jobStatus: "assigned", area: "Atlanta" }), null);
});

test("a second offer is its own text and a cancelled job sends none", () => {
  const first = pilotSmsText({ kind: "offer", jobStatus: "open" });
  const second = pilotSmsText({ kind: "offer", jobStatus: "open" });
  assert.equal(first, second);
  for (const kind of pilotSmsKinds) {
    if (kind === "driver_approved") continue;
    assert.equal(pilotSmsText({ kind, service: "junk", jobStatus: "cancelled", area: "Atlanta" }), null);
    assert.equal(pilotSmsText({ kind, service: "delivery", jobStatus: "disputed", area: "Atlanta" }), null);
  }
});

test("completion text waits until confirmation is actually required", () => {
  assert.equal(pilotSmsText({ kind: "delivered", jobStatus: "in_transit", service: "delivery" }), null);
  assert.equal(pilotSmsText({ kind: "delivered", jobStatus: "completed", service: "junk" }), null);
  assert.equal(pilotSmsText({ kind: "completed", jobStatus: "completed", service: "delivery" }), null);
  assert.notEqual(pilotSmsText({ kind: "delivered", jobStatus: "delivered", service: "junk" }), null);
});

test("unrelated jobs and unfinished approval do not send", () => {
  assert.equal(pilotSmsText({ kind: "new_job", service: "construction", jobStatus: "open", area: "Atlanta" }), null);
  assert.equal(pilotSmsText({ kind: "payment_needed", jobStatus: "assigned" }), null);
  assert.equal(pilotSmsText({ kind: "driver_approved", driverStatus: "pending_review" }), null);
  assert.equal(pilotSmsText({ kind: "driver_approved", driverStatus: "paused" }), null);
});

test("the platform switch and a repeated send still block the text", () => {
  const ready = channelPlan({
    platformSms: false,
    pushEnabled: true,
    emailEnabled: true,
    smsEnabled: true,
    hasSubscription: false,
    hasEmail: false,
    hasPhone: true,
    hasPushKey: false,
    hasEmailKey: false,
    hasSmsKey: true,
    hasConsent: true,
    pushSent: true,
    emailSent: true,
    smsSent: false,
  });
  assert.equal(ready.sms, "skip");
  const sentAlready = channelPlan({
    platformSms: true,
    pushEnabled: false,
    emailEnabled: false,
    smsEnabled: true,
    hasSubscription: false,
    hasEmail: false,
    hasPhone: true,
    hasPushKey: false,
    hasEmailKey: false,
    hasSmsKey: true,
    hasConsent: true,
    pushSent: true,
    emailSent: true,
    smsSent: true,
  });
  assert.equal(sentAlready.sms, "skip");
});
