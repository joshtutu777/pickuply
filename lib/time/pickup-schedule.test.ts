import assert from "node:assert/strict";
import test from "node:test";
import {
  addClockMinutes,
  arrivalError,
  defaultPickupWindow,
  extraPickupWindow,
  availabilityError,
  availabilitySummary,
  formatOfferWhen,
  legacyWhen,
  pickupWindowError,
  zonedWallTime,
} from "./pickup-schedule";

const now = new Date("2026-10-27T16:00:00.000Z");

test("anytime and ASAP do not need a customer window", () => {
  assert.equal(availabilityError("anytime", [], now), null);
  assert.equal(availabilityError("asap", [], now), null);
  assert.match(availabilitySummary("anytime", []), /will not arrive unannounced/);
  assert.match(availabilitySummary("asap", []), /does not promise an immediate pickup/);
  assert.deepEqual(legacyWhen("anytime", []), { preferred_date: "asap", time_window: null });
  assert.deepEqual(legacyWhen("asap", []), { preferred_date: "asap", time_window: null });
});

test("one and three windows are accepted and a fourth is not", () => {
  const one = [{ date: "2026-10-28", start: "14:00", end: "16:00" }];
  assert.equal(pickupWindowError(one, now), null);
  assert.deepEqual(legacyWhen("windows", one), { preferred_date: "2026-10-28", time_window: "afternoon" });
  const three = [
    { date: "2026-10-28", start: "09:00", end: "11:00" },
    { date: "2026-10-29", start: "10:00", end: "12:00" },
    { date: "2026-10-30", start: "13:00", end: "15:00" },
  ];
  assert.equal(pickupWindowError(three, now), null);
  assert.match(pickupWindowError([...three, { date: "2026-10-31", start: "09:00", end: "10:00" }], now) ?? "", /1 and 3/);
});

test("windows reject a backwards range, overlap, and a window that already ended", () => {
  assert.match(
    pickupWindowError([{ date: "2026-10-28", start: "16:00", end: "14:00" }], now) ?? "",
    /later than the start/,
  );
  assert.match(
    pickupWindowError(
      [
        { date: "2026-10-28", start: "10:00", end: "12:00" },
        { date: "2026-10-28", start: "11:00", end: "13:00" },
      ],
      now,
    ) ?? "",
    /overlap/,
  );
  assert.match(
    pickupWindowError([{ date: "2026-10-27", start: "08:00", end: "09:00" }], now) ?? "",
    /past/,
  );
});

test("preset durations stay on the same day", () => {
  assert.equal(addClockMinutes("14:00", 120), "16:00");
  assert.equal(addClockMinutes("22:30", 120), null);
});

test("a missing or past arrival time is rejected", () => {
  assert.equal(arrivalError("2026-10-28", "14:00", now), null);
  assert.match(arrivalError("2026-10-27", "11:00", now) ?? "", /passed/);
  assert.match(arrivalError("", "", now) ?? "", /date and arrival/);
});

test("an Anytime or ASAP arrival must be at least 30 minutes ahead", () => {
  const noon = zonedWallTime("2026-10-27", "12:00");
  assert.match(arrivalError("2026-10-27", "12:20", noon) ?? "", /30 minutes/);
  assert.equal(arrivalError("2026-10-27", "12:30", noon), null);
  assert.equal(arrivalError("2026-10-27", "12:20", noon, 15), null);
});

test("daylight-saving gaps are rejected and the repeated hour keeps its wall clock", () => {
  assert.throws(() => zonedWallTime("2026-03-08", "02:30"), /does not exist/);
  const folded = zonedWallTime("2026-11-01", "01:30");
  const wall = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(folded);
  assert.match(wall, /11\/01\/2026/);
  assert.match(wall, /01:30/);
});

test("defaults use the next open morning, afternoon, or evening preset", () => {
  const morning = zonedWallTime("2026-10-27", "08:00");
  assert.deepEqual(defaultPickupWindow(morning), { date: "2026-10-27", start: "09:00", end: "11:00" });

  const afternoon = zonedWallTime("2026-10-27", "12:30");
  assert.deepEqual(defaultPickupWindow(afternoon), { date: "2026-10-27", start: "13:00", end: "15:00" });
  assert.match(pickupWindowError([{ date: "2026-10-27", start: "09:00", end: "11:00" }], afternoon) ?? "", /past/);

  const earlyEvening = zonedWallTime("2026-10-27", "17:00");
  assert.deepEqual(defaultPickupWindow(earlyEvening), { date: "2026-10-27", start: "16:00", end: "18:00" });

  const lateEvening = zonedWallTime("2026-10-27", "20:00");
  const first = defaultPickupWindow(lateEvening);
  assert.deepEqual(first, { date: "2026-10-28", start: "09:00", end: "11:00" });
  assert.match(pickupWindowError([{ date: "2026-10-27", start: "16:00", end: "18:00" }], lateEvening) ?? "", /past/);
  const added = extraPickupWindow([first], lateEvening);
  assert.deepEqual(added, { date: "2026-10-28", start: "13:00", end: "15:00" });
  assert.equal(pickupWindowError([first, added], lateEvening), null);

  const nearMidnight = zonedWallTime("2026-10-27", "23:40");
  assert.deepEqual(defaultPickupWindow(nearMidnight), { date: "2026-10-28", start: "09:00", end: "11:00" });
  assert.match(pickupWindowError([{ date: "2026-10-27", start: "16:00", end: "18:00" }], nearMidnight) ?? "", /past/);
});

test("a customer window must end at least 60 minutes from now", () => {
  const oneMinuteLeft = zonedWallTime("2026-10-27", "10:59");
  assert.match(
    pickupWindowError([{ date: "2026-10-27", start: "09:00", end: "11:00" }], oneMinuteLeft) ?? "",
    /60 minutes/,
  );
  assert.deepEqual(defaultPickupWindow(oneMinuteLeft), { date: "2026-10-27", start: "13:00", end: "15:00" });
  const exactlyOneHour = zonedWallTime("2026-10-27", "10:00");
  assert.equal(pickupWindowError([{ date: "2026-10-27", start: "09:00", end: "11:00" }], exactlyOneHour), null);
  const justAfterEvening = zonedWallTime("2026-10-27", "17:01");
  assert.deepEqual(defaultPickupWindow(justAfterEvening), { date: "2026-10-28", start: "09:00", end: "11:00" });
  const ended = zonedWallTime("2026-10-27", "11:00");
  assert.match(pickupWindowError([{ date: "2026-10-27", start: "09:00", end: "11:00" }], ended) ?? "", /past/);
});

test("offer times read as tomorrow or a window without a phone or street", () => {
  const point = formatOfferWhen("2026-10-28T18:00:00.000Z", null, now);
  const span = formatOfferWhen("2026-10-28T13:00:00.000Z", "2026-10-28T15:00:00.000Z", now);
  assert.match(point, /^Tomorrow, 2:00 PM$/);
  assert.match(span, /^Tomorrow, 9:00–11:00 AM$/);
  assert.equal(/(\+1|\d{3}-\d{3}|Street|Avenue|Apt)/i.test(`${point} ${span}`), false);
});
