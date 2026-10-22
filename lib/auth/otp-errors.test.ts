import assert from "node:assert/strict";
import test from "node:test";
import { mapOtpError, otpErrorCopy } from "./otp-errors";

const phone = "+15555550100";

function assertNoPhone(text: string) {
  assert.equal(text.includes("5555550100"), false);
  assert.equal(text.includes(phone), false);
  assert.equal(text.includes("555-555-0100"), false);
}

test("invalid numbers, bad codes, rate limits, network, and a missing SMS provider stay generic", () => {
  const invalid = mapOtpError(
    { message: `Invalid phone number: ${phone}`, status: 422 },
    "send",
  );
  assert.equal(invalid, otpErrorCopy.invalidNumber);
  assertNoPhone(invalid);

  const provider = mapOtpError(
    { message: `Error sending confirmation OTP to ${phone}`, status: 500 },
    "send",
  );
  assert.equal(provider, otpErrorCopy.smsUnavailable);
  assert.equal(provider.toLowerCase().includes("sent"), false);
  assertNoPhone(provider);

  const disabled = mapOtpError(
    { code: "phone_provider_disabled", message: `Phone log for ${phone}` },
    "send",
  );
  assert.equal(disabled, otpErrorCopy.smsUnavailable);
  assertNoPhone(disabled);

  const limited = mapOtpError(
    { status: 429, message: `Too many requests for ${phone}` },
    "send",
  );
  assert.equal(limited, otpErrorCopy.tooMany);
  assertNoPhone(limited);

  const network = mapOtpError(
    { message: "Failed to fetch", name: "AuthRetryableFetchError" },
    "send",
  );
  assert.equal(network, otpErrorCopy.network);
  assertNoPhone(network);

  const expired = mapOtpError(
    { code: "otp_expired", message: `Token has expired or is invalid for ${phone}` },
    "verify",
  );
  assert.equal(expired, otpErrorCopy.badCode);
  assertNoPhone(expired);

  const rawPhone = mapOtpError({ message: phone }, "send");
  assert.notEqual(rawPhone, phone);
  assertNoPhone(rawPhone);
});
