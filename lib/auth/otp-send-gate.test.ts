import assert from "node:assert/strict";
import test from "node:test";
import { claimOtpSend, finishOtpSend, type OtpSendGate } from "./otp-send-gate";

const COOLDOWN_MS = 30_000;

function gate(): OtpSendGate {
  return { inFlight: false, coolingUntil: 0 };
}

test("two rapid sends start only one request", async () => {
  const sendGate = gate();
  let requests = 0;

  async function send() {
    if (!claimOtpSend(sendGate, 1_000)) return;
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    finishOtpSend(sendGate, "sent", 1_020, COOLDOWN_MS);
  }

  await Promise.all([send(), send()]);
  assert.equal(requests, 1);
  assert.equal(sendGate.inFlight, false);
  assert.equal(claimOtpSend(sendGate, 1_020), false);
});

test("a failed send can be retried", async () => {
  const sendGate = gate();
  let requests = 0;

  async function send() {
    if (!claimOtpSend(sendGate, 5_000)) return false;
    requests += 1;
    await Promise.resolve();
    finishOtpSend(sendGate, "failed", 5_010, COOLDOWN_MS);
    return true;
  }

  assert.equal(await send(), true);
  assert.equal(await send(), true);
  assert.equal(requests, 2);
  assert.equal(sendGate.inFlight, false);
  assert.equal(sendGate.coolingUntil, 0);
});

test("a second tap during the request starts only one send", async () => {
  const sendGate = gate();
  let requests = 0;

  async function send(result: "sent" | "failed") {
    if (!claimOtpSend(sendGate, 2_000)) return false;
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    finishOtpSend(sendGate, result, 2_020, 0);
    return true;
  }

  const first = send("sent");
  const second = send("sent");
  const results = await Promise.all([first, second]);
  assert.deepEqual(results, [true, false]);
  assert.equal(requests, 1);
  assert.equal(sendGate.inFlight, false);
  assert.equal(sendGate.coolingUntil, 0);
});

test("a failed send can be retried immediately", async () => {
  const sendGate = gate();
  let requests = 0;

  async function send() {
    if (!claimOtpSend(sendGate, 3_000)) return false;
    requests += 1;
    await Promise.resolve();
    finishOtpSend(sendGate, "failed", 3_010, 0);
    return true;
  }

  assert.equal(await send(), true);
  assert.equal(await send(), true);
  assert.equal(requests, 2);
  assert.equal(sendGate.coolingUntil, 0);
});

test("signup and sign-in both keep the 30 second resend cooldown", () => {
  const sendGate = gate();
  assert.equal(claimOtpSend(sendGate, 4_000), true);
  finishOtpSend(sendGate, "sent", 4_100, COOLDOWN_MS);
  assert.equal(sendGate.inFlight, false);
  assert.equal(claimOtpSend(sendGate, 4_100), false);
  assert.equal(claimOtpSend(sendGate, 4_100 + COOLDOWN_MS), true);
});

test("a sent code keeps the 30 second resend cooldown", () => {
  const sendGate = gate();
  assert.equal(claimOtpSend(sendGate, 10_000), true);
  finishOtpSend(sendGate, "sent", 10_500, COOLDOWN_MS);
  assert.equal(sendGate.inFlight, false);
  assert.equal(claimOtpSend(sendGate, 10_500), false);
  assert.equal(claimOtpSend(sendGate, 40_499), false);
  assert.equal(claimOtpSend(sendGate, 40_500), true);
});
