import assert from "node:assert/strict";
import test from "node:test";
import { driverJobCounts, driverJobHref, groupDriverJobs, type DriverJobListItem } from "./job-groups";

function job(partial: Partial<DriverJobListItem> & Pick<DriverJobListItem, "id" | "status">): DriverJobListItem {
  return {
    service: "delivery",
    paymentStatus: null,
    pickupArea: "Austell 30106",
    retired: false,
    ...partial,
  };
}

test("driver job lists keep active work reachable and retired jobs closed", () => {
  const groups = groupDriverJobs([
    job({ id: "a", status: "assigned", paymentStatus: "awaiting_payment" }),
    job({ id: "b", status: "en_route", paymentStatus: "authorized" }),
    job({ id: "c", status: "completed", paymentStatus: "captured" }),
    job({ id: "d", status: "cancelled" }),
    job({ id: "e", status: "assigned", retired: true }),
  ]);
  assert.deepEqual(groups.mine.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(groups.active.map((item) => item.id), ["b"]);
  assert.deepEqual(groups.awaiting.map((item) => item.id), ["a"]);
  assert.deepEqual(groups.completed.map((item) => item.id), ["c"]);
  assert.deepEqual(groups.closed.map((item) => item.id), ["d", "e"]);
  assert.equal(driverJobHref(groups.closed[1]), null);
  assert.equal(driverJobHref(groups.active[0]), "/driver/jobs/b");
  assert.deepEqual(driverJobCounts(groups, 3), {
    available: 3,
    mine: 2,
    active: 1,
    awaiting: 1,
    completed: 1,
    closed: 2,
  });
});
