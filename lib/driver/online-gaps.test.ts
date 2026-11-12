import assert from "node:assert/strict";
import test from "node:test";
import { documentReviewNotes, onlineGaps } from "./online-gaps";

const ready = {
  status: "active",
  licenseExpires: "2027-12-31",
  insuranceUrl: "doc",
  insuranceExpires: "2027-12-31",
  vehicleApproved: true,
  checklistRequired: true,
  agreementSigned: true,
  termsVersion: "driver-terms-v2",
  trainingDone: true,
  serviceCount: 1,
  today: "2026-10-22",
};

test("an approved driver with the checklist done has nothing missing", () => {
  assert.deepEqual(onlineGaps(ready), []);
});

test("an older agreement does not count as the current Driver Terms", () => {
  const gaps = onlineGaps({ ...ready, termsVersion: null });
  assert.match(gaps[0]?.label ?? "", /Driver Terms/);
});

test("an expired license does not block an approved driver", () => {
  assert.deepEqual(onlineGaps({ ...ready, licenseExpires: "2020-01-01" }), []);
});

test("a missing or expired license does not block Online", () => {
  assert.deepEqual(onlineGaps({ ...ready, licenseExpires: null }), []);
  assert.deepEqual(onlineGaps({ ...ready, licenseExpires: "2020-01-01" }), []);
});

test("missing or expired insurance does not block Online and stays visible for review", () => {
  assert.deepEqual(onlineGaps({ ...ready, insuranceUrl: null, insuranceExpires: null }), []);
  assert.deepEqual(onlineGaps({ ...ready, insuranceExpires: "2020-01-01" }), []);
  assert.deepEqual(
    documentReviewNotes({
      licenseUrl: null,
      licenseExpires: null,
      insuranceUrl: "doc",
      insuranceExpires: "2020-01-01",
      today: ready.today,
    }),
    ["Driver license photo is missing.", "Insurance date has passed."],
  );
});

test("an unready driver is told the application is still in review", () => {
  const gaps = onlineGaps({
    ...ready,
    status: "pending_review",
    insuranceUrl: null,
    vehicleApproved: false,
    agreementSigned: false,
    trainingDone: false,
    serviceCount: 0,
  });
  assert.equal(gaps.length, 1);
  assert.match(gaps[0]?.label ?? "", /in review/);
  assert.equal(gaps[0]?.href, "/driver");
  const paused = onlineGaps({ ...ready, status: "paused" });
  assert.match(paused[0]?.label ?? "", /Driving is paused/);
  const removed = onlineGaps({ ...ready, status: "removed" });
  assert.match(removed[0]?.label ?? "", /closed/);
});
