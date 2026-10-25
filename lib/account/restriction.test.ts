import assert from "node:assert/strict";
import test from "node:test";
import { deletionGraceOpen, parseNyDateTime, phoneReuseNotice, restrictionNotice } from "./restriction";

test("an indefinite customer notice does not say the restriction is temporary", () => {
  const notice = restrictionNotice("customer", { active: true, kind: "indefinite", expires_at: null });
  assert.equal(
    notice?.body,
    "Your Pickuply account is restricted. You cannot create or book new pickups while this restriction is active.",
  );
  assert.equal(notice?.body.includes("temporarily"), false);
  assert.equal(notice?.until, null);
});

test("a temporary customer notice names the restriction and the New York end time", () => {
  const notice = restrictionNotice("customer", {
    active: true,
    kind: "temporary",
    expires_at: "2026-07-15T19:00:00.000Z",
  });
  assert.equal(notice?.body.includes("temporarily"), true);
  assert.match(notice?.until ?? "", /Jul 15, 2026/);
  assert.match(notice?.until ?? "", /EDT/);
});

test("a driver notice uses the driver wording", () => {
  const notice = restrictionNotice("driver", { active: true, kind: "indefinite", expires_at: null });
  assert.equal(
    notice?.body,
    "Your Pickuply driver account is restricted. You cannot submit offers or accept new jobs while this restriction is active.",
  );
});

test("a reused phone notice does not mention a suspension", () => {
  assert.equal(phoneReuseNotice.includes("suspend"), false);
  assert.match(phoneReuseNotice, /Contact support/);
});

test("an inactive account has no notice", () => {
  assert.equal(restrictionNotice("customer", { active: false }), null);
});

test("the deletion cancel window stays open only before the saved end time", () => {
  const now = Date.parse("2026-10-24T12:00:00.000Z");
  assert.equal(deletionGraceOpen("pending", "2026-10-25T12:00:00.000Z", now), true);
  assert.equal(deletionGraceOpen("pending", "2026-10-24T12:00:00.000Z", now), false);
  assert.equal(deletionGraceOpen("cancelled", "2026-10-25T12:00:00.000Z", now), false);
});

test("a New York wall time is stored in UTC across daylight saving", () => {
  assert.equal(parseNyDateTime("2026-07-15T15:00"), "2026-07-15T19:00:00.000Z");
  assert.equal(parseNyDateTime("2026-01-15T15:00"), "2026-01-15T20:00:00.000Z");
  assert.equal(parseNyDateTime("2026-03-09T12:00"), "2026-03-09T16:00:00.000Z");
  assert.equal(parseNyDateTime("2026-11-02T12:00"), "2026-11-02T17:00:00.000Z");
});
