import assert from "node:assert/strict";
import test from "node:test";
import { otpErrorCopy } from "./otp-errors";
import { otpSendMessages } from "./otp-send-limit";
import { checkSignInCode, deliverSignInCode } from "./otp-send-flow";
import { isSyntheticOtpPhone } from "./synthetic-otp";

test("a rejected request does not call the text provider", async () => {
  let sent = 0;
  const result = await deliverSignInCode("+14045550199", {
    synthetic: () => false,
    reserve: async () => otpSendMessages.cooldown,
    send: async () => {
      sent += 1;
      return null;
    },
  });
  assert.equal(result, otpSendMessages.cooldown);
  assert.equal(sent, 0);
});

test("a real number on a shared network is still sent", async () => {
  let sent = 0;
  const result = await deliverSignInCode("+14045550100", {
    synthetic: () => false,
    reserve: async () => null,
    send: async () => {
      sent += 1;
      return null;
    },
  });
  assert.equal(result, null);
  assert.equal(sent, 1);
});

test("a synthetic number does not use the shared counters", async () => {
  let reserved = 0;
  let sent = 0;
  const result = await deliverSignInCode("+15555550301", {
    reserve: async () => {
      reserved += 1;
      return otpSendMessages.burst;
    },
    send: async () => {
      sent += 1;
      return null;
    },
  });
  assert.equal(result, null);
  assert.equal(reserved, 0);
  assert.equal(sent, 1);
});

test("a real number cannot use the synthetic list", () => {
  assert.equal(isSyntheticOtpPhone("+15555550301"), true);
  assert.equal(isSyntheticOtpPhone("+15555550205"), true);
  assert.equal(isSyntheticOtpPhone("+14045550199"), false);
  assert.equal(isSyntheticOtpPhone("+15555550100"), false);
  assert.equal(isSyntheticOtpPhone("+15555550999"), false);
});

test("wrong codes are counted and a blocked code is not checked again", async () => {
  let checks = 0;
  let failures = 0;
  const wrong = await checkSignInCode("+14045550199", "000000", {
    synthetic: () => false,
    blocked: async () => null,
    verify: async () => {
      checks += 1;
      return otpErrorCopy.badCode;
    },
    noteFailure: async () => {
      failures += 1;
    },
  });
  assert.equal(wrong, otpErrorCopy.badCode);
  assert.equal(checks, 1);
  assert.equal(failures, 1);

  checks = 0;
  const blocked = await checkSignInCode("+14045550199", "000000", {
    synthetic: () => false,
    blocked: async () => otpSendMessages.verify,
    verify: async () => {
      checks += 1;
      return null;
    },
    noteFailure: async () => {
      failures += 1;
    },
  });
  assert.equal(blocked, otpSendMessages.verify);
  assert.equal(checks, 0);
});

test("an expired code uses the same sentence and is counted", async () => {
  let failures = 0;
  const result = await checkSignInCode("+14045550199", "111111", {
    synthetic: () => false,
    blocked: async () => null,
    verify: async () => otpErrorCopy.badCode,
    noteFailure: async () => {
      failures += 1;
    },
  });
  assert.equal(result, otpErrorCopy.badCode);
  assert.equal(failures, 1);
});

test("a network failure is not counted as a wrong code", async () => {
  let failures = 0;
  const result = await checkSignInCode("+14045550199", "111111", {
    synthetic: () => false,
    blocked: async () => null,
    verify: async () => otpErrorCopy.network,
    noteFailure: async () => {
      failures += 1;
    },
  });
  assert.equal(result, otpErrorCopy.network);
  assert.equal(failures, 0);
});

test("customer and driver sign-in use this same send and check", async () => {
  const phones = ["+14045550111", "+14045550222"];
  let sent = 0;
  for (const phone of phones) {
    assert.equal(
      await deliverSignInCode(phone, {
        synthetic: () => false,
        reserve: async () => null,
        send: async () => {
          sent += 1;
          return null;
        },
      }),
      null,
    );
  }
  assert.equal(sent, 2);
});
