import assert from "node:assert/strict";
import test from "node:test";
import { buildLeadReport, leadRange, visitInactivityMs, type LeadEvent, type LeadJob, type LeadVisit } from "./lead-metrics";

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
