import assert from "node:assert/strict";
import test from "node:test";
import { applicationStatusCopy } from "./application-status";

test("pending and paused drivers get a plain status", () => {
  assert.equal(applicationStatusCopy("pending_review")?.title, "Application submitted");
  assert.equal(applicationStatusCopy("applied")?.title, "Application submitted");
  assert.match(applicationStatusCopy("paused")?.body ?? "", /paused|cannot take jobs/i);
  assert.equal(applicationStatusCopy("removed")?.title, "Application closed");
  assert.equal(applicationStatusCopy("active"), null);
  assert.equal(applicationStatusCopy("approved_new"), null);
});
