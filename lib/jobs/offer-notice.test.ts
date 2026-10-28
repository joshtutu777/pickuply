import assert from "node:assert/strict";
import test from "node:test";
import { readOfferNotice, writeOfferNotice } from "./offer-notice";

test("a rejection notice is kept for one job and ignored when it is not", () => {
  const stored = writeOfferNotice({ jobId: "job-a", message: "This request is no longer open." });
  assert.deepEqual(readOfferNotice(stored), { jobId: "job-a", message: "This request is no longer open." });
  assert.equal(readOfferNotice("This request is no longer open."), null);
  assert.equal(readOfferNotice(""), null);
  assert.equal(readOfferNotice(null), null);
  assert.equal(readOfferNotice(JSON.stringify({ jobId: "", message: "No" })), null);
});
