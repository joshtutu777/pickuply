import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { leadWriteAllowed } from "../analytics/attribution";
import {
  buildLeadReport,
  buildVisitFunnel,
  leadRange,
  visitInactivityMs,
  type LeadEvent,
  type LeadJob,
  type LeadVisit,
  type VisitFunnelFilters,
} from "./lead-metrics";

const start = new Date("2026-11-17T05:00:00.000Z");
const end = new Date("2026-11-18T05:00:00.000Z");
const now = new Date("2026-11-17T18:00:00.000Z");

function event(sessionId: string, stage: LeadEvent["stage"], at: string, service: string | null = null): LeadEvent {
  return { sessionId, stage, service, at };
}

function job(overrides: Partial<LeadJob> = {}): LeadJob {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    service: "delivery",
    status: "requested",
    createdAt: "2026-11-17T15:00:00.000Z",
    paymentStatus: null,
    capturedCents: null,
    refundedCents: null,
    paymentDueAt: null,
    checkoutAt: null,
    authorizedAt: null,
    capturedAt: null,
    deliveredAt: null,
    transferAt: null,
    transferred: false,
    firstUtmSource: null,
    lastUtmSource: null,
    firstReferrerHost: null,
    lastReferrerHost: null,
    firstCampaign: null,
    lastCampaign: null,
    firstAdset: null,
    lastAdset: null,
    firstAd: null,
    lastAd: null,
    ...overrides,
  };
}

function report(events: LeadEvent[], jobs: LeadJob[] = [], visits: LeadVisit[] = []) {
  return buildLeadReport({
    events,
    visits,
    jobs,
    start,
    end,
    now,
    group: "day",
    touch: "last",
    service: "",
    status: "",
    source: "",
  });
}

test("a recent visit step is still open, not abandoned", () => {
  const result = report([
    event("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "landing_viewed", "2026-11-17T17:50:00.000Z"),
    event("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "request_started", "2026-11-17T17:55:00.000Z"),
  ]);
  const started = result.visitFunnel.find((row) => row.key === "request_started");
  assert.equal(started?.abandoned, 0);
  assert.equal(started?.inProgress, 1);
  assert.equal(result.biggestDropOff, null);
});

test("a quiet visit step is abandoned only after 30 minutes", () => {
  const quiet = new Date(now.getTime() - visitInactivityMs - 1000).toISOString();
  const result = report([
    event("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "landing_viewed", quiet),
    event("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "request_started", quiet),
  ]);
  const started = result.visitFunnel.find((row) => row.key === "request_started");
  assert.equal(started?.abandoned, 1);
  assert.equal(started?.inProgress, 0);
  assert.equal(result.biggestDropOff, "Request started");
});

test("an authorization is not captured revenue", () => {
  const saved = job({
    paymentStatus: "authorized",
    checkoutAt: "2026-11-17T16:00:00.000Z",
    authorizedAt: "2026-11-17T16:05:00.000Z",
    capturedCents: null,
  });
  const result = report([], [saved]);
  assert.equal(result.authorized, 1);
  assert.equal(result.captured, 0);
  assert.equal(result.revenueCents, 0);
  assert.equal(result.averageOrderCents, null);
});

test("captured revenue sums captured amounts and keeps refunds separate", () => {
  const result = report([], [
    job({
      id: "22222222-2222-4222-8222-222222222222",
      paymentStatus: "captured",
      capturedCents: 5250,
      refundedCents: 500,
      checkoutAt: "2026-11-17T16:00:00.000Z",
      authorizedAt: "2026-11-17T16:05:00.000Z",
      capturedAt: "2026-11-17T17:00:00.000Z",
    }),
  ]);
  assert.equal(result.captured, 1);
  assert.equal(result.revenueCents, 5250);
  assert.equal(result.refundedCents, 500);
  assert.equal(result.netRevenueCents, 4750);
  assert.equal(result.activity[0]?.refund, "partial");
});

test("a checkout inside its payment window is not abandoned", () => {
  const result = report([], [
    job({
      checkoutAt: "2026-11-17T16:00:00.000Z",
      paymentDueAt: "2026-11-17T19:00:00.000Z",
    }),
  ]);
  const checkout = result.jobFunnel.find((row) => row.key === "checkout_started");
  assert.equal(checkout?.abandoned, 0);
  assert.equal(checkout?.inProgress, 1);
  assert.equal(result.jobFunnel.find((row) => row.key === "request_saved")?.abandoned, 0);
});

test("all four services have a funnel", () => {
  const result = report([]);
  assert.deepEqual(
    result.serviceFunnels.map((item) => item.service),
    ["delivery", "free_item", "junk", "construction"],
  );
});

test("missing landing data does not invent a conversion rate", () => {
  const result = report([], [job()]);
  assert.equal(result.visitorToLead, null);
  assert.equal(result.visitorToPaying, null);
  assert.equal(result.submitted, 1);
});

test("date presets use an Eastern day", () => {
  const range = leadRange("today", "", "", now);
  assert.equal(range.start.toISOString(), "2026-11-17T05:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-11-18T05:00:00.000Z");
});

const sessionA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sessionC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function filters(overrides: Partial<VisitFunnelFilters> = {}): VisitFunnelFilters {
  return {
    start,
    end,
    source: "",
    campaign: "",
    service: "",
    stage: "",
    touch: "last",
    drill: "",
    ...overrides,
  };
}

function visit(sessionId: string, overrides: Partial<LeadVisit> = {}): LeadVisit {
  return {
    sessionId,
    firstUtmSource: null,
    lastUtmSource: null,
    firstReferrerHost: null,
    lastReferrerHost: null,
    firstCampaign: null,
    lastCampaign: null,
    firstAdset: null,
    lastAdset: null,
    firstAd: null,
    lastAd: null,
    landingPath: null,
    ...overrides,
  };
}

test("a request-page visit is not counted as a landing session", () => {
  const result = buildVisitFunnel({
    events: [event(sessionB, "request_viewed", "2026-11-17T15:00:00.000Z")],
    visits: [],
    now,
    filters: filters(),
  });
  assert.equal(result.rows.find((row) => row.key === "landing_viewed")?.reached, 0);
  assert.equal(result.rows.find((row) => row.key === "request_viewed")?.reached, 1);
  assert.equal(result.rows.find((row) => row.key === "request_viewed")?.overallRate, 1);
});

test("step conversion uses the sessions that reached that step", () => {
  const quiet = new Date(now.getTime() - visitInactivityMs - 1000).toISOString();
  const result = buildVisitFunnel({
    events: [
      event(sessionA, "landing_viewed", quiet),
      event(sessionA, "request_started", quiet),
      event(sessionB, "request_viewed", "2026-11-17T17:50:00.000Z"),
    ],
    visits: [],
    now,
    filters: filters(),
  });
  const landing = result.rows.find((row) => row.key === "landing_viewed");
  const viewed = result.rows.find((row) => row.key === "request_viewed");
  const started = result.rows.find((row) => row.key === "request_started");
  assert.equal(result.sessions, 2);
  assert.equal(landing?.reached, 1);
  assert.equal(landing?.continued, 1);
  assert.equal(landing?.stepRate, 0);
  assert.equal(landing?.abandoned, 0);
  assert.equal(viewed?.reached, 1);
  assert.equal(viewed?.stepRate, 0);
  assert.equal(started?.reached, 1);
  assert.equal(started?.abandoned, 1);
  assert.equal((started?.abandoned ?? 0) + (started?.inProgress ?? 0), 1);
  assert.equal(result.biggestDropOff, "Request started");
});

test("a selected stage follows only the sessions that reached it", () => {
  const result = buildVisitFunnel({
    events: [
      event(sessionA, "landing_viewed", "2026-11-17T15:00:00.000Z"),
      event(sessionB, "request_started", "2026-11-17T15:00:00.000Z", "junk"),
      event(sessionB, "request_submitted", "2026-11-17T16:00:00.000Z", "junk"),
    ],
    visits: [],
    now,
    filters: filters({ stage: "request_started" }),
  });
  assert.equal(result.sessions, 1);
  assert.equal(result.rows[0]?.key, "request_started");
  assert.equal(result.rows.find((row) => row.key === "landing_viewed"), undefined);
  assert.equal(result.rows.find((row) => row.key === "request_submitted")?.reached, 1);
  assert.equal(result.rows.find((row) => row.key === "request_submitted")?.overallRate, 1);
  assert.equal(result.overallConversion, 1);
});

test("source, campaign, and service filters combine before the funnel is counted", () => {
  const events = [
    event(sessionA, "landing_viewed", "2026-11-17T15:00:00.000Z", "delivery"),
    event(sessionA, "request_submitted", "2026-11-17T16:00:00.000Z", "delivery"),
    event(sessionB, "landing_viewed", "2026-11-17T15:00:00.000Z", "junk"),
    event(sessionC, "request_started", "2026-11-17T17:40:00.000Z"),
  ];
  const visits = [
    visit(sessionA, { lastUtmSource: "facebook", lastCampaign: "Spring chairs" }),
    visit(sessionB, { lastUtmSource: "google", lastCampaign: "Spring chairs" }),
    visit(sessionC),
  ];
  const combined = buildVisitFunnel({
    events,
    visits,
    now,
    filters: filters({ source: "facebook", campaign: "Spring chairs", service: "delivery" }),
  });
  assert.equal(combined.sessions, 1);
  assert.equal(combined.rows.find((row) => row.key === "landing_viewed")?.reached, 1);
  assert.equal(combined.overallConversion, 1);
  assert.deepEqual(combined.campaigns, ["Spring chairs"]);
  const facebook = buildVisitFunnel({ events, visits, now, filters: filters({ source: "facebook" }) });
  assert.equal(facebook.sessions, 1);
  const google = buildVisitFunnel({ events, visits, now, filters: filters({ source: "google" }) });
  assert.equal(google.sessions, 1);
  assert.equal(google.rows.find((row) => row.key === "landing_viewed")?.reached, 1);
  const unknown = buildVisitFunnel({ events, visits, now, filters: filters({ source: "unknown" }) });
  assert.equal(unknown.sessions, 1);
  assert.equal(unknown.rows.find((row) => row.key === "landing_viewed")?.reached, 0);
  const none = buildVisitFunnel({ events, visits, now, filters: filters({ source: "instagram" }) });
  assert.equal(none.empty, true);
  assert.equal(none.overallConversion, null);
  assert.equal(none.rows.every((row) => row.reached === 0), true);
});

test("a service filter ignores sessions that never selected that service", () => {
  const result = buildVisitFunnel({
    events: [
      event(sessionA, "service_selected", "2026-11-17T15:00:00.000Z", "junk"),
      event(sessionB, "service_selected", "2026-11-17T15:00:00.000Z", "delivery"),
      event(sessionC, "request_viewed", "2026-11-17T15:00:00.000Z"),
    ],
    visits: [],
    now,
    filters: filters({ service: "junk" }),
  });
  assert.equal(result.sessions, 1);
  assert.equal(result.rows.find((row) => row.key === "service_selected")?.reached, 1);
});

test("visit dates follow Eastern midnight and leave out the ending instant", () => {
  const today = leadRange("today", "", "", now);
  const yesterday = leadRange("yesterday", "", "", now);
  const week = leadRange("7d", "", "", now);
  assert.equal(yesterday.start.toISOString(), "2026-11-16T05:00:00.000Z");
  assert.equal(yesterday.end.toISOString(), today.start.toISOString());
  assert.equal(week.start.toISOString(), "2026-11-11T05:00:00.000Z");
  assert.equal(week.end.toISOString(), today.end.toISOString());
  const before = buildVisitFunnel({
    events: [event(sessionA, "landing_viewed", "2026-11-17T04:59:59.000Z")],
    visits: [],
    now,
    filters: filters({ start: today.start, end: today.end }),
  });
  const included = buildVisitFunnel({
    events: [event(sessionA, "landing_viewed", "2026-11-17T05:00:00.000Z")],
    visits: [],
    now,
    filters: filters({ start: today.start, end: today.end }),
  });
  const excludedEnd = buildVisitFunnel({
    events: [event(sessionA, "landing_viewed", today.end.toISOString())],
    visits: [],
    now,
    filters: filters({ start: today.start, end: today.end }),
  });
  assert.equal(before.sessions, 0);
  assert.equal(included.sessions, 1);
  assert.equal(excludedEnd.sessions, 0);
});

test("a visit with no stored source or campaign stays Unknown", () => {
  const result = buildVisitFunnel({
    events: [event(sessionC, "landing_viewed", "2026-11-17T15:00:00.000Z")],
    visits: [visit(sessionC, { lastUtmSource: "facebook" })],
    now,
    filters: filters({ campaign: "__unknown__", drill: "landing_viewed" }),
  });
  assert.equal(result.sessions, 1);
  assert.deepEqual(result.drill?.sources, [{ label: "Facebook", count: 1 }]);
  assert.deepEqual(result.drill?.campaigns, [{ label: "Unknown", count: 1 }]);
  assert.deepEqual(result.drill?.services, [{ label: "Not selected", count: 1 }]);
  assert.deepEqual(result.drill?.sessions, [sessionC]);
});

test("a rejected or unanswered consent choice adds no visit session", () => {
  assert.equal(leadWriteAllowed("denied"), false);
  assert.equal(leadWriteAllowed("unknown"), false);
  assert.equal(leadWriteAllowed(""), false);
  assert.equal(leadWriteAllowed("granted"), true);
  const result = buildVisitFunnel({ events: [], visits: [], now, filters: filters() });
  assert.equal(result.empty, true);
  assert.equal(result.sessions, 0);
});

test("visit filters do not change saved-request counts", () => {
  const saved = report([], [job()]);
  assert.equal(saved.submitted, 1);
  assert.equal(saved.revenueCents, 0);
  assert.equal(saved.visitFunnel.every((row) => row.reached === 0), true);
  const visits = buildVisitFunnel({
    events: [event(sessionA, "landing_viewed", "2026-11-17T15:00:00.000Z")],
    visits: [],
    now,
    filters: filters(),
  });
  assert.equal("revenueCents" in visits, false);
  assert.equal(visits.sessions, 1);
});

test("reloading visit sessions is limited to an admin and skips customer records", () => {
  const action = readFileSync(new URL("../../app/admin/analytics/leads/actions.ts", import.meta.url), "utf8");
  const load = readFileSync(new URL("./lead-load.ts", import.meta.url), "utf8");
  const activity = load.slice(load.indexOf("export async function loadVisitActivity"));
  assert.match(action, /requireAdmin\("\/admin\/analytics\/leads"\)/);
  assert.equal(activity.includes('from("jobs")'), false);
  assert.equal(activity.includes("job_payments"), false);
  assert.equal(activity.includes("ledger_entries"), false);
  assert.equal(/email|phone|full_name|street/i.test(activity), false);
});
