import assert from "node:assert/strict";
import test from "node:test";
import { optionalArrivalProblem, type PickupPlan } from "./pickup-schedule";

const now = new Date("2026-11-02T20:00:00.000Z");
const blank = { date: "", time: "", windowId: "" };
const asap: PickupPlan = { availability: "asap", timezone: "America/New_York", windows: [] };
const anytime: PickupPlan = { availability: "anytime", timezone: "America/New_York", windows: [] };
const legacy: PickupPlan = { availability: null, timezone: null, windows: [] };
const openWindow = {
  id: "window-1",
  starts_at: "2026-11-03T15:00:00.000Z",
  ends_at: "2026-11-03T17:00:00.000Z",
  position: 1,
};
const windows: PickupPlan = {
  availability: "windows",
  timezone: "America/New_York",
  windows: [openWindow],
};

test("a blank arrival is allowed for every pickup timing", () => {
  for (const plan of [asap, anytime, windows, legacy, undefined, null]) {
    assert.equal(optionalArrivalProblem(plan, blank, 30, now), null);
  }
});

test("a partial arrival is still checked", () => {
  assert.match(
    optionalArrivalProblem(asap, { date: "2026-11-03", time: "", windowId: "" }, 30, now) ?? "",
    /date and arrival time/,
  );
  assert.match(
    optionalArrivalProblem(windows, { date: "", time: "10:00", windowId: "" }, 30, now) ?? "",
    /pickup windows/,
  );
});

test("a selected open window can omit the exact arrival", () => {
  assert.equal(
    optionalArrivalProblem(windows, { date: "", time: "", windowId: openWindow.id }, 30, now),
    null,
  );
});

test("a passed window is not accepted as an optional choice", () => {
  const passed: PickupPlan = {
    availability: "windows",
    timezone: "America/New_York",
    windows: [{ ...openWindow, ends_at: "2026-11-01T15:00:00.000Z" }],
  };
  assert.match(
    optionalArrivalProblem(passed, { date: "", time: "", windowId: openWindow.id }, 30, now) ?? "",
    /passed/,
  );
});
