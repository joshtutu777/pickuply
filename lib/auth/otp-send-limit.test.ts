import assert from "node:assert/strict";
import test from "node:test";
import { otpSendLimits, reserveOtpSend, type OtpLimitLedger } from "./otp-send-limit";

function ledger(): OtpLimitLedger {
  return { phones: new Map(), ips: new Map() };
}

test("login and the request form share one hourly phone limit", () => {
  const counts = ledger();
  const phone = "same-phone";
  const ip = "same-network";
  const sources = ["login", "request", "login", "request", "login"] as const;

  for (const source of sources) {
    assert.equal(reserveOtpSend(counts, phone, ip), null, source);
  }

  assert.equal(reserveOtpSend(counts, phone, ip), otpSendLimits.phone.message);
  assert.equal(reserveOtpSend(counts, phone, ip), otpSendLimits.phone.message);
  assert.equal(counts.phones.get(phone), otpSendLimits.phone.max);
  assert.equal(otpSendLimits.phone.max, 5);
  assert.equal(otpSendLimits.phone.windowSeconds, 3600);
  assert.equal(otpSendLimits.phone.message.includes("555"), false);
  assert.equal(otpSendLimits.phone.message.includes("+1"), false);
});

test("login and the request form share one hourly network limit", () => {
  const counts = ledger();
  const ip = "shared-network";

  for (let index = 0; index < otpSendLimits.ip.max; index += 1) {
    const source = index % 2 === 0 ? "login" : "request";
    assert.equal(reserveOtpSend(counts, `phone-${index}`, ip), null, source);
  }

  assert.equal(reserveOtpSend(counts, "one-more-phone", ip), otpSendLimits.ip.message);
  assert.equal(counts.ips.get(ip), otpSendLimits.ip.max);
  assert.equal(otpSendLimits.ip.max, 10);
  assert.equal(otpSendLimits.ip.windowSeconds, 3600);
  assert.equal(otpSendLimits.ip.message.includes("555"), false);
});

test("a different phone is not blocked by another number on the same limit", () => {
  const counts = ledger();
  for (let index = 0; index < otpSendLimits.phone.max; index += 1) {
    assert.equal(reserveOtpSend(counts, "first-phone", "network"), null);
  }
  assert.equal(reserveOtpSend(counts, "first-phone", "network"), otpSendLimits.phone.message);
  assert.equal(reserveOtpSend(counts, "second-phone", "another-network"), null);
});
