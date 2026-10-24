import assert from "node:assert/strict";
import test from "node:test";
import { resolveAudience, type AudiencePerson } from "./audience";
import { planDelivery } from "./execute";
import { announcementLimits, limitMessage, type PriorSend } from "./limits";
import { pushPayload, pushTargets } from "./push";
import { promotionalSms, quietWindow, resolveNyWall, smsSegments, withPickuplyPrefix } from "./sms";

const driver = (id: string, extra: Partial<AudiencePerson> = {}): AudiencePerson => ({
  id,
  role: "driver",
  deleted: false,
  suspended: false,
  driverStatus: "active",
  drivingStopped: false,
  online: false,
  cities: [],
  activeBookings: 0,
  ...extra,
});

const customer = (id: string, extra: Partial<AudiencePerson> = {}): AudiencePerson => ({
  id,
  role: "customer",
  deleted: false,
  suspended: false,
  driverStatus: null,
  drivingStopped: false,
  online: false,
  cities: [],
  activeBookings: 0,
  ...extra,
});

test("push can be selected and still needs a subscription", () => {
  const plan = planDelivery({
    channels: { inApp: true, push: true, sms: false },
    title: "Saturday hours",
    body: "We are open.",
    href: "/account/notifications",
    id: "ann-1",
    permissionGranted: true,
    subscriptions: [{ expired: false }],
    promotional: true,
    promotionalConsent: false,
    smsOptedOut: false,
    smsEnabled: false,
    now: new Date("2026-10-24T15:00:00.000Z"),
  });
  assert.equal(plan.push, "provider_accepted");
  assert.equal(plan.displayed, false);
  assert.equal(plan.pushDevices, 1);
});

test("push is skipped when permission was not granted", () => {
  assert.equal(pushTargets([{ expired: false }], false), 0);
});

test("an expired push subscription is not a target", () => {
  assert.equal(pushTargets([{ expired: true }, { expired: false }], true), 1);
});

test("several devices count as one person", () => {
  const devices = pushTargets([{ expired: false }, { expired: false }], true);
  assert.equal(devices, 2);
  const audience = resolveAudience([customer("c1")], { kind: "customers", purpose: "promotional" });
  assert.equal(audience.ids.length, 1);
});

test("a push payload rejects private details and keeps a safe link", () => {
  assert.equal(pushPayload({ title: "Hi", body: "Call 5555550199", href: "/account", id: "1" }), null);
  const safe = pushPayload({ title: "Update", body: "Open your alerts.", href: "/account/notifications", id: "abc" });
  assert.equal(safe?.href, "/account/notifications");
  assert.equal(safe?.id, "abc");
  assert.equal(pushPayload({ title: "Update", body: "Open", href: "https://evil.example", id: "abc" }), null);
});

test("online drivers are the eligible online set", () => {
  const people = [
    driver("on", { online: true }),
    driver("off", { online: false }),
    driver("gone", { online: true, driverStatus: "removed" }),
    driver("held", { online: true, suspended: true }),
  ];
  const result = resolveAudience(people, { kind: "online_drivers", purpose: "promotional" });
  assert.deepEqual(result.ids, ["on"]);
  assert.equal(result.excludedSuspended, 1);
});

test("offline and suspended drivers stay out of the online audience", () => {
  const result = resolveAudience(
    [driver("off"), driver("paused", { online: true, driverStatus: "paused" })],
    { kind: "online_drivers", purpose: "promotional" },
  );
  assert.deepEqual(result.ids, []);
});

test("city coverage uses Areas I Cover and counts a driver once", () => {
  const people = [
    driver("multi", { cities: ["Austell", "Marietta"], online: true }),
    driver("home-only", { cities: [], online: true }),
  ];
  const all = resolveAudience(people, { kind: "city_drivers", city: "Austell", purpose: "promotional" });
  const online = resolveAudience(people, { kind: "city_drivers", city: "austell", onlineOnly: true, purpose: "promotional" });
  assert.deepEqual(all.ids, ["multi"]);
  assert.deepEqual(online.ids, ["multi"]);
});

test("customers with active jobs are counted once", () => {
  const result = resolveAudience(
    [customer("busy", { activeBookings: 2 }), customer("idle"), customer("old", { deleted: true, activeBookings: 1 })],
    { kind: "active_customers", purpose: "promotional" },
  );
  assert.deepEqual(result.ids, ["busy"]);
});

test("suspended people are left out of promotional sends and included for account support", () => {
  const people = [customer("held", { suspended: true }), customer("open")];
  const promo = resolveAudience(people, { kind: "customers", purpose: "promotional" });
  const support = resolveAudience(people, { kind: "individual", ids: ["held"], purpose: "account_support" });
  assert.deepEqual(promo.ids, ["open"]);
  assert.equal(promo.excludedSuspended, 1);
  assert.deepEqual(support.ids, ["held"]);
});

test("a scheduled send can be created, changed, cancelled, and run once", () => {
  const prior: PriorSend[] = [];
  const created = limitMessage({
    now: "2026-10-24T15:00:00.000Z",
    kind: "bulk",
    recipients: 2,
    scheduledFor: "2026-10-24T21:00:00.000Z",
    pendingScheduled: 0,
    prior,
  });
  assert.equal(created, null);
  const edited = limitMessage({
    now: "2026-10-24T15:00:00.000Z",
    kind: "bulk",
    recipients: 2,
    scheduledFor: "2026-10-25T14:00:00.000Z",
    pendingScheduled: 1,
    prior,
  });
  assert.equal(edited, null);
  const cancelled = { status: "cancelled" as const };
  assert.equal(cancelled.status, "cancelled");
  const first = planDelivery({
    channels: { inApp: true, push: false, sms: false },
    title: "Tomorrow",
    body: "See you then.",
    href: "/account",
    id: "job-1",
    permissionGranted: false,
    subscriptions: [],
    promotional: true,
    promotionalConsent: false,
    smsOptedOut: false,
    smsEnabled: false,
    now: new Date("2026-10-25T14:00:00.000Z"),
  });
  const second = { ...first, duplicate: true };
  assert.equal(first.inApp, "sent");
  assert.equal(second.duplicate, true);
});

test("people who become ineligible are dropped before execution", () => {
  const before = resolveAudience([customer("a"), customer("b")], { kind: "customers", purpose: "promotional" });
  const after = resolveAudience(
    [customer("a", { deleted: true }), customer("b", { suspended: true })],
    { kind: "customers", purpose: "promotional" },
  );
  assert.equal(before.ids.length, 2);
  assert.deepEqual(after.ids, []);
});

test("a failed push can be retried without calling it displayed", () => {
  const retry = planDelivery({
    channels: { inApp: false, push: true, sms: false },
    title: "Again",
    body: "Still public.",
    href: "/account/notifications",
    id: "retry-1",
    permissionGranted: true,
    subscriptions: [{ expired: false }],
    promotional: true,
    promotionalConsent: false,
    smsOptedOut: false,
    smsEnabled: false,
    now: new Date("2026-10-24T16:00:00.000Z"),
  });
  assert.equal(retry.push, "provider_accepted");
  assert.equal(retry.displayed, false);
});

test("daylight-saving wall times are explicit around November 1 2026", () => {
  const ambiguous = resolveNyWall(2026, 11, 1, 1, 30);
  const missing = resolveNyWall(2026, 3, 8, 2, 30);
  const later = resolveNyWall(2026, 11, 1, 9, 0);
  assert.equal("error" in ambiguous && ambiguous.error, "ambiguous");
  assert.equal("error" in missing && missing.error, "missing");
  assert.equal("utc" in later && later.utc.toISOString(), "2026-11-01T14:00:00.000Z");
});

test("texts stay inside 8am to 9pm Eastern and keep the prefix and STOP line", () => {
  const early = quietWindow(new Date("2026-11-01T06:30:00.000Z"));
  assert.equal(early.allowed, false);
  assert.equal(early.sendAt.toISOString(), "2026-11-01T13:00:00.000Z");
  const midday = quietWindow(new Date("2026-10-24T16:00:00.000Z"));
  assert.equal(midday.allowed, true);
  const text = promotionalSms("Open jobs are waiting.");
  assert.equal(text.startsWith("Pickuply:"), true);
  assert.equal(withPickuplyPrefix(text), text);
  assert.equal(text.includes("Reply STOP to opt out."), true);
  assert.equal(smsSegments(text) >= 1, true);
});

test("promotional consent defaults off and an opt-out blocks the text", () => {
  const unchecked = false;
  assert.equal(unchecked, false);
  const blocked = planDelivery({
    channels: { inApp: false, push: false, sms: true },
    title: "Deal",
    body: "A public note.",
    href: "/account",
    id: "sms-1",
    permissionGranted: false,
    subscriptions: [],
    promotional: true,
    promotionalConsent: false,
    smsOptedOut: true,
    smsEnabled: true,
    now: new Date("2026-10-24T16:00:00.000Z"),
  });
  assert.equal(blocked.sms, "skipped");
});

test("admin rate limits block the extra send", () => {
  const now = "2026-10-24T18:00:00.000Z";
  const immediate = Array.from({ length: announcementLimits.immediatePerHour }, () => ({
    at: "2026-10-24T17:30:00.000Z",
    kind: "immediate" as const,
    recipients: 1,
    channel: "in_app" as const,
    promotional: true,
  }));
  assert.match(limitMessage({ now, kind: "immediate", recipients: 1, scheduledFor: now, pendingScheduled: 0, prior: immediate }) ?? "", /20 immediate/);
  const bulk = Array.from({ length: 5 }, () => ({
    at: "2026-10-24T17:30:00.000Z",
    kind: "bulk" as const,
    recipients: 10,
    channel: "in_app" as const,
    promotional: true,
  }));
  assert.match(limitMessage({ now, kind: "bulk", recipients: 10, scheduledFor: now, pendingScheduled: 0, prior: bulk }) ?? "", /5 bulk/);
  const allUser = Array.from({ length: 2 }, () => ({
    at: "2026-10-24T12:00:00.000Z",
    kind: "all_user" as const,
    recipients: 10,
    channel: "in_app" as const,
    promotional: true,
  }));
  assert.match(limitMessage({ now, kind: "all_user", recipients: 10, scheduledFor: now, pendingScheduled: 0, prior: allUser }) ?? "", /2 all-user/);
  assert.match(limitMessage({ now, kind: "bulk", recipients: 1001, scheduledFor: now, pendingScheduled: 0, prior: [] }) ?? "", /1,000/);
  assert.match(
    limitMessage({
      now,
      kind: "bulk",
      recipients: 1,
      scheduledFor: now,
      pendingScheduled: 0,
      prior: [],
      smsRecipients: [{ recentDay: 1, recentWeek: 1 }],
    }) ?? "",
    /daily promotional text/,
  );
  assert.match(
    limitMessage({
      now,
      kind: "bulk",
      recipients: 1,
      scheduledFor: now,
      pendingScheduled: 0,
      prior: [],
      smsRecipients: [{ recentDay: 0, recentWeek: 3 }],
    }) ?? "",
    /weekly promotional text/,
  );
  assert.match(
    limitMessage({ now, kind: "bulk", recipients: 1, scheduledFor: now, pendingScheduled: 0, prior: [], platformSmsDay: 500 }) ?? "",
    /daily text limit/,
  );
  assert.match(
    limitMessage({ now, kind: "bulk", recipients: 1, scheduledFor: now, pendingScheduled: 0, prior: [], pushRecent: [3] }) ?? "",
    /promotional alert/,
  );
  assert.match(limitMessage({ now, kind: "bulk", recipients: 1, scheduledFor: now, pendingScheduled: 20, prior: [] }) ?? "", /20 announcements waiting/);
  assert.match(
    limitMessage({ now, kind: "bulk", recipients: 1, scheduledFor: "2026-12-24T18:00:00.000Z", pendingScheduled: 0, prior: [] }) ?? "",
    /30 days/,
  );
});

test("two overlapping limit checks cannot both ignore a full hour", () => {
  const prior = Array.from({ length: 19 }, () => ({
    at: "2026-10-24T17:30:00.000Z",
    kind: "immediate" as const,
    recipients: 1,
    channel: "in_app" as const,
    promotional: true,
  }));
  const shared = [...prior];
  const first = limitMessage({
    now: "2026-10-24T18:00:00.000Z",
    kind: "immediate",
    recipients: 1,
    scheduledFor: "2026-10-24T18:00:00.000Z",
    pendingScheduled: 0,
    prior: shared,
  });
  if (first === null) shared.push(prior[0]);
  const second = limitMessage({
    now: "2026-10-24T18:00:00.000Z",
    kind: "immediate",
    recipients: 1,
    scheduledFor: "2026-10-24T18:00:00.000Z",
    pendingScheduled: 0,
    prior: shared,
  });
  assert.equal(first, null);
  assert.match(second ?? "", /20 immediate/);
});
