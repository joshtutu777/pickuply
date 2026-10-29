import assert from "node:assert/strict";
import test from "node:test";
import {
  otpLimitCoverage,
  otpSendMessages,
  otpSendPolicy,
  otpVerifyBlocked,
  reserveOtpSend,
  type OtpSendEvent,
} from "./otp-send-limit";

const now = 1_000_000_000_000;

function send(events: OtpSendEvent[], phone: string, ip: string, at = now): string | null {
  return reserveOtpSend(events, phone, ip, at);
}

test("several people on one network can each request a code", () => {
  const events: OtpSendEvent[] = [];
  for (let index = 0; index < 12; index += 1) {
    assert.equal(send(events, `phone-${index}`, "shared-wifi"), null);
  }
  assert.equal(events.length, 12);
});

test("the same phone must wait 30 seconds, then can request again", () => {
  const events: OtpSendEvent[] = [];
  assert.equal(send(events, "phone", "home", now), null);
  assert.equal(send(events, "phone", "home", now + 1_000), otpSendMessages.cooldown);
  assert.equal(events.length, 1);
  assert.equal(send(events, "phone", "home", now + otpSendPolicy.cooldownMs), null);
  assert.equal(events.length, 2);
});

test("a script that tries many new numbers from one network is stopped", () => {
  const events: OtpSendEvent[] = [];
  for (let index = 0; index < otpSendPolicy.burstDistinctPhones; index += 1) {
    assert.equal(send(events, `bot-${index}`, "script", now), null);
  }
  assert.equal(send(events, "bot-extra", "script", now + 1_000), otpSendMessages.burst);
  assert.equal(events.length, otpSendPolicy.burstDistinctPhones);
  assert.equal(send(events, "bot-0", "script", now + otpSendPolicy.cooldownMs), null);
});

test("a number can still be used through the day, then stops", () => {
  const events: OtpSendEvent[] = [];
  for (let index = 0; index < otpSendPolicy.phoneDailyMax; index += 1) {
    assert.equal(send(events, "phone", "home", now + index * otpSendPolicy.cooldownMs), null);
  }
  assert.equal(
    send(events, "phone", "home", now + otpSendPolicy.phoneDailyMax * otpSendPolicy.cooldownMs),
    otpSendMessages.phoneDaily,
  );
  assert.equal(events.length, otpSendPolicy.phoneDailyMax);
});

test("a sustained flood of new numbers is stopped without blocking an earlier number", () => {
  const events: OtpSendEvent[] = [];
  const batch = otpSendPolicy.burstDistinctPhones;
  let added = 0;
  for (let wave = 0; added < otpSendPolicy.sustainedDistinctPhones; wave += 1) {
    const at = now + wave * otpSendPolicy.burstMs;
    const room = otpSendPolicy.sustainedDistinctPhones - added;
    const count = Math.min(batch, room);
    for (let index = 0; index < count; index += 1) {
      assert.equal(send(events, `person-${added + index}`, "carrier", at), null);
    }
    added += count;
  }
  const later = now + 5 * otpSendPolicy.burstMs;
  assert.equal(send(events, "one-more", "carrier", later), otpSendMessages.sustained);
  assert.equal(send(events, "person-0", "carrier", later), null);
});

test("five wrong codes block another try until the window passes", () => {
  const failures = [now, now + 1, now + 2, now + 3, now + 4];
  assert.equal(otpVerifyBlocked(failures.slice(0, 4), now + 5), false);
  assert.equal(otpVerifyBlocked(failures, now + 5), true);
  assert.equal(otpVerifyBlocked(failures, now + otpSendPolicy.verifyWindowMs + 5), false);
  assert.equal(otpSendMessages.verify.includes("555"), false);
});

test("a direct Auth request is outside the custom text and wrong-code limits", () => {
  assert.equal(otpLimitCoverage.appSendChecksCustomPolicy, true);
  assert.equal(otpLimitCoverage.directAuthSendChecksCustomPolicy, false);
  assert.equal(otpLimitCoverage.sendSmsHookRequiredForEveryText, true);
  assert.equal(otpLimitCoverage.appVerifyChecksFiveWrongCodes, true);
  assert.equal(otpLimitCoverage.directAuthVerifyChecksFiveWrongCodes, false);
});

test("the old hourly phone and network quotas are gone", () => {
  const messages = Object.values(otpSendMessages).join(" ");
  assert.equal(messages.includes("in an hour"), false);
  assert.equal(otpSendPolicy.cooldownMs, 30_000);
});
