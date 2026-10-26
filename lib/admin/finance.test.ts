import assert from "node:assert/strict";
import test from "node:test";
import { inTestLane } from "./test-lane";
import {
  attentionIssues,
  changePercent,
  filterJobs,
  listTotal,
  midnightInNewYork,
  paymentBuckets,
  pricingBalances,
  paymentChip,
  revenue,
  sortJobs,
  toCsv,
  type FinanceFilters,
  type FinanceJob,
} from "./finance";

const now = new Date("2026-10-24T16:00:00.000Z");

function job(overrides: Partial<FinanceJob> = {}): FinanceJob {
  return {
    id: "job-1",
    customerId: "customer-1",
    customerFirst: "Casey",
    driverId: "driver-1",
    driverFirst: "Pat",
    service: "delivery",
    pricingMethod: "fixed",
    jobStatus: "delivered",
    paymentStatus: "captured",
    pickupCity: "Austell",
    pickupZip: "30168",
    priceCents: 15000,
    driverPayCents: 13035,
    capturedCents: 15000,
    refundedCents: 0,
    platformFeeCents: 1500,
    serviceFeeCents: 465,
    stripeFeeCents: 465,
    tripFeeCents: null,
    lateCancelCents: null,
    paymentDueAt: null,
    captureBefore: null,
    createdAt: "2026-10-24T15:00:00.000Z",
    jobUpdatedAt: "2026-10-24T15:40:00.000Z",
    customerConfirmedAt: "2026-10-24T15:40:00.000Z",
    bookedAt: "2026-10-24T15:10:00.000Z",
    capturedAt: "2026-10-24T15:40:00.000Z",
    refundedAt: null,
    paidOutAt: null,
    paymentIntentId: "pi_test_123",
    ledgerStatus: "held_until_onboarding",
    ledgerAmountCents: 13035,
    transferStatus: null,
    transferId: null,
    holdReason: "Finish payout setup",
    ledgerAvailableOn: "2026-10-20T15:00:00.000Z",
    openReport: false,
    openDispute: false,
    payoutsEnabled: false,
    caseNumber: null,
    ...overrides,
  };
}

function filters(overrides: Partial<FinanceFilters> = {}): FinanceFilters {
  return {
    tab: "payments",
    range: "today",
    from: "",
    to: "",
    date: "requested",
    cities: [],
    zips: [],
    service: "",
    pricing: "",
    amountMin: "",
    amountMax: "",
    q: "",
    paymentStatus: "",
    fee: "",
    hold: "",
    report: "",
    customer: "",
    ledgerStatus: "",
    transferStatus: "",
    holdReason: "",
    overdue: "",
    driver: "",
    payoutSetup: "",
    issue: "",
    group: "day",
    compare: false,
    sort: "newest",
    page: 1,
    ...overrides,
  };
}

test("midnight in New York is 04:00 UTC during October daylight time", () => {
  assert.equal(midnightInNewYork(2026, 10, 24).toISOString(), "2026-10-24T04:00:00.000Z");
});

test("New York midnight follows the 2026 daylight-saving changes", () => {
  assert.equal(midnightInNewYork(2026, 3, 8).toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(midnightInNewYork(2026, 3, 9).toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal(midnightInNewYork(2026, 11, 1).toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(midnightInNewYork(2026, 11, 2).toISOString(), "2026-11-02T05:00:00.000Z");
});

test("each payment status uses the stored state", () => {
  assert.equal(paymentChip(job({ paymentStatus: "awaiting_payment", capturedCents: null })), "awaiting_payment");
  assert.equal(paymentChip(job({ paymentStatus: "authorized", capturedCents: null })), "held");
  assert.equal(paymentChip(job()), "charged");
  assert.equal(paymentChip(job({ capturedCents: 2500, priceCents: 15000 })), "partially_charged");
  assert.equal(paymentChip(job({ paymentStatus: "canceled", capturedCents: null })), "released");
  assert.equal(paymentChip(job({ paymentStatus: "refunded", refundedCents: 15000 })), "refunded");
  assert.equal(paymentChip(job({ openDispute: true })), "disputed");
  assert.equal(paymentChip(job({ paymentStatus: "failed", capturedCents: null })), "failed");
});

test("a missing captured amount is unavailable instead of zero", () => {
  const buckets = paymentBuckets([job({ paymentStatus: "captured", capturedCents: null })]);
  assert.deepEqual(buckets.charged.amount, { unavailable: true });
  assert.equal(buckets.charged.count, 1);
});

test("filters combine and the total matches the remaining rows", () => {
  const rows = [
    job(),
    job({
      id: "job-2",
      customerFirst: "Robin",
      customerId: "customer-2",
      pickupCity: "Smyrna",
      pickupZip: "30080",
      service: "junk",
      priceCents: 8000,
      capturedCents: 8000,
      createdAt: "2026-10-24T14:00:00.000Z",
    }),
    job({ id: "job-3", paymentStatus: "authorized", capturedCents: null, capturedAt: null, priceCents: 5000 }),
  ];
  const filtered = filterJobs(rows, filters({ cities: ["Austell"], service: "delivery", amountMin: "100" }), now);
  assert.deepEqual(filtered.map((row) => row.id), ["job-1"]);
  assert.equal(listTotal(filtered, "payments"), "1 payments · $150 charged");
});

test("csv matches the filtered list and does not turn a missing amount into zero", () => {
  const rows = [job({ capturedCents: null, priceCents: null })];
  const csv = toCsv(filterJobs(rows, filters(), now));
  assert.match(csv, /Unavailable/);
  assert.equal(csv.trim().split("\n").length, 2);
});

test("a real admin total leaves out a synthetic capture", () => {
  const synthetic = job({
    id: "synthetic",
    capturedCents: 6210,
    priceCents: 6210,
    platformFeeCents: 900,
    serviceFeeCents: 210,
    driverPayCents: 5100,
  });
  const real = job({ id: "real", capturedCents: 5000, priceCents: 5000 });
  const rows = [
    { ...synthetic, isTest: true },
    { ...real, isTest: false },
  ];
  const visible = rows.filter((row) => inTestLane(row.isTest, "real"));
  const result = revenue(visible);
  assert.equal(visible.length, 1);
  assert.equal(visible[0]?.id, "real");
  assert.deepEqual(result.platform, { cents: 1500 });
  assert.deepEqual(revenue(rows).platform, { cents: 2400 });
});

test("revenue uses stored fees and leaves an unknown Stripe fee unavailable", () => {
  const result = revenue([job({ stripeFeeCents: null })]);
  assert.deepEqual(result.stripe, { unavailable: true });
  assert.deepEqual(result.lateCancel, { cents: 0 });
  assert.deepEqual(revenue([job({ lateCancelCents: 1500, capturedCents: 1500 })]).lateCancel, { cents: 1500 });
  assert.deepEqual(result.net, { unavailable: true });
});

test("sorting and attention use the stored deadlines", () => {
  const older = job({ id: "old", createdAt: "2026-10-24T12:00:00.000Z" });
  const newer = job({ id: "new", createdAt: "2026-10-24T15:30:00.000Z" });
  assert.deepEqual(sortJobs([older, newer], filters({ sort: "oldest" })).map((row) => row.id), ["old", "new"]);
  const expiring = job({
    paymentStatus: "authorized",
    capturedCents: null,
    captureBefore: "2026-10-24T20:00:00.000Z",
  });
  assert.ok(attentionIssues(expiring, now).includes("hold_expiring"));
});

test("stored offer parts add up and a completed ledger matches driver earnings", () => {
  assert.equal(pricingBalances(job()), true);
  assert.equal(pricingBalances(job({
    jobStatus: "completed",
    ledgerAmountCents: 13_035,
  })), true);
  assert.equal(pricingBalances(job({
    jobStatus: "completed",
    ledgerAmountCents: 10_000,
  })), false);
  assert.equal(pricingBalances(job({ platformFeeCents: 1 })), false);
});

test("a previous period of zero is not compared as a percent", () => {
  assert.equal(changePercent({ cents: 100 }, { cents: 0 }), "Not comparable");
  assert.equal(changePercent({ cents: 150 }, { cents: 100 }), "+50%");
});
