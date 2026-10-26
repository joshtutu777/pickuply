import assert from "node:assert/strict";
import test from "node:test";
import { cronErrorText } from "./errors";
import { cronRunLabel } from "./jobs";

test("cron errors drop tokens and card keys", () => {
  const text = cronErrorText(
    new Error("Authorization Bearer super-secret failed sk_test_abc whsec_def"),
    "super-secret",
  );
  assert.equal(text.includes("super-secret"), false);
  assert.equal(text.includes("sk_test_"), false);
  assert.equal(text.includes("whsec_"), false);
  assert.match(text, /\[redacted\]/);
});

test("a blank cron error still has a status", () => {
  assert.equal(cronErrorText(new Error("   ")), "The scheduled job failed.");
});

test("a missing cron run is shown separately from a failure", () => {
  assert.equal(cronRunLabel(null), "Not run yet");
  assert.equal(cronRunLabel(true), "Succeeded");
  assert.equal(cronRunLabel(false), "Failed");
});
