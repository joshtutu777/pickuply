import assert from "node:assert/strict";
import test from "node:test";
import { onlineGaps } from "./online-gaps";

const ready = {
  status: "active",
  licenseExpires: "2027-12-31",
  insuranceUrl: "doc",
  insuranceExpires: "2027-12-31",
  vehicleApproved: true,
  checklistRequired: true,
  agreementSigned: true,
  termsVersion: "driver-terms-v1",
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

test("a missing insurance upload is not an Online block, and an expired policy is", () => {
  const missing = onlineGaps({ ...ready, insuranceUrl: null, insuranceExpires: null });
  assert.equal(missing.find((gap) => gap.href === "/driver/ready/insurance"), undefined);
  const expired = onlineGaps({ ...ready, insuranceExpires: "2020-01-01" });
  assert.match(expired[0]?.label ?? "", /insurance expired/);
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
