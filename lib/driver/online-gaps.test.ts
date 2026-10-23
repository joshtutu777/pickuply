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
  trainingDone: true,
  serviceCount: 1,
  today: "2026-10-22",
};

test("an approved driver with the checklist done has nothing missing", () => {
  assert.deepEqual(onlineGaps(ready), []);
});

test("an unready driver gets a link for each missing item", () => {
  const gaps = onlineGaps({
    ...ready,
    status: "pending_review",
    insuranceUrl: null,
    vehicleApproved: false,
    agreementSigned: false,
    trainingDone: false,
    serviceCount: 0,
  });
  assert.equal(gaps.length, 6);
  assert.match(gaps[0]?.label ?? "", /in review/);
  assert.equal(gaps[0]?.href, "/driver");
  assert.equal(gaps.find((gap) => gap.href === "/driver/ready/insurance")?.label.includes("insurance"), true);
  const paused = onlineGaps({ ...ready, status: "paused" });
  assert.match(paused[0]?.label ?? "", /Driving is paused/);
  const removed = onlineGaps({ ...ready, status: "removed" });
  assert.match(removed[0]?.label ?? "", /closed/);
});
