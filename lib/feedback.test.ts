import assert from "node:assert/strict";
import test from "node:test";
import { feedbackFilters, safeDeviceInfo, safePagePath, validateFeedback } from "./feedback";

test("feedback validation accepts a complete report and rejects short or unknown fields", () => {
  assert.equal(validateFeedback({ type: "bug", subject: "Map pin", details: "The pin stayed on the old ZIP." }), null);
  assert.equal(validateFeedback({ type: "other", subject: "Map pin", details: "The pin stayed on the old ZIP." }), "Choose a feedback type.");
  assert.equal(validateFeedback({ type: "bug", subject: "No", details: "The pin stayed on the old ZIP." }), "Subject must be 3 to 120 characters.");
  assert.equal(validateFeedback({ type: "bug", subject: "Map pin", details: "Too short" }), "Details must be 10 to 4000 characters.");
});

test("feedback context keeps a route and drops private query data", () => {
  assert.equal(safePagePath("/account/jobs"), "/account/jobs");
  assert.equal(safePagePath("/jobs/abc?token=secret&address=1 Main"), "/jobs/abc");
  assert.equal(safePagePath("https://evil.example/account"), "/feedback");
  assert.equal(safePagePath("//admin"), "/feedback");
  assert.equal(safeDeviceInfo("Mozilla/5.0 (iPhone)"), "Mozilla/5.0 (iPhone)");
  assert.equal(safeDeviceInfo("a".repeat(200))?.length, 160);
  assert.equal(safeDeviceInfo("   "), null);
});

test("feedback filters ignore unknown values and keep a page number", () => {
  const filters = feedbackFilters({
    status: "under_review",
    type: "nope",
    role: "driver",
    from: "2026-10-01",
    to: "tomorrow",
    q: "pin%_drop",
    page: "2",
  });
  assert.deepEqual(filters, {
    status: "under_review",
    type: "",
    role: "driver",
    from: "2026-10-01",
    to: "",
    q: "pindrop",
    page: 2,
  });
});
