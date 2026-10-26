import assert from "node:assert/strict";
import test from "node:test";
import {
  adminNavCurrent,
  adminTabTitle,
  auditLabel,
  dashboardCounts,
  documentExpiresSoon,
  filterJobs,
  jobEventLabel,
  needsAction,
  openWithoutOffers,
  paymentNearDeadline,
  quoteExpiresSoon,
  readableTime,
  waitedLabel,
  type AdminDriver,
  type AdminJob,
} from "./ops";

const now = Date.parse("2026-10-22T16:00:00.000Z");

function job(overrides: Partial<AdminJob> = {}): AdminJob {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    service: "delivery",
    status: "requested",
    createdAt: "2026-10-22T15:48:00.000Z",
    pricingMethod: "quote",
    pickupArea: "Austell 30168",
    zoneId: null,
    paymentStatus: null,
    paymentDueAt: null,
    quoteExpiresAt: null,
    assignedDriverId: null,
    customerId: null,
    preferredDate: "asap",
    itemValueCents: 0,
    offerCents: null,
    budgetMinCents: null,
    budgetMaxCents: null,
    priceCents: null,
    openedAt: null,
    quotedAt: null,
    offerCount: 0,
    hasRequestPhotos: false,
    overThousand: false,
    specialty: false,
    ...overrides,
  };
}

function driver(overrides: Partial<AdminDriver> = {}): AdminDriver {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    status: "pending_review",
    homeCity: "Austell",
    zoneId: null,
    online: false,
    licenseExpires: "2027-12-31",
    insuranceExpires: "2027-12-31",
    createdAt: "2026-10-22T14:00:00.000Z",
    name: "Pat Driver",
    ...overrides,
  };
}

test("a request waiting on customer details leaves the review queue", () => {
  const waiting = job({ detailsOpen: true });
  const ready = job({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" });
  const items = needsAction([waiting, ready], [], now);
  assert.deepEqual(
    items.map((item) => item.id),
    ["request-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"],
  );
});

test("the tab title shows the action count", () => {
  assert.equal(adminTabTitle(0), "Pickuply Admin");
  assert.equal(adminTabTitle(3), "(3) Pickuply Admin");
});

test("needs action is oldest first and ignores a bare phone-number style wait", () => {
  const fresh = job({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", createdAt: "2026-10-22T15:50:00.000Z" });
  const older = job({ createdAt: "2026-10-22T12:00:00.000Z" });
  const open = job({
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    status: "open",
    createdAt: "2026-10-22T15:00:00.000Z",
    openedAt: "2026-10-22T15:50:00.000Z",
    offerCount: 0,
  });
  const items = needsAction([fresh, older, open], [driver()], now);
  assert.deepEqual(
    items.map((item) => item.kind),
    ["request", "driver", "request"],
  );
  assert.equal(openWithoutOffers(open, now), false);
  assert.equal(items.some((item) => item.area.includes("+1")), false);
});

test("quote, offer, and payment rules use the planned windows", () => {
  const quoted = job({
    status: "quoted",
    quoteExpiresAt: "2026-10-22T17:30:00.000Z",
    quotedAt: "2026-10-22T15:00:00.000Z",
  });
  const stale = job({
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    status: "open",
    openedAt: "2026-10-22T15:30:00.000Z",
    offerCount: 0,
  });
  const offered = job({
    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    status: "open",
    openedAt: "2026-10-22T15:00:00.000Z",
    offerCount: 1,
  });
  const due = job({
    id: "11111111-1111-4111-8111-111111111111",
    status: "assigned",
    paymentStatus: "awaiting_payment",
    paymentDueAt: "2026-10-22T16:10:00.000Z",
  });
  assert.equal(quoteExpiresSoon(quoted, now), true);
  assert.equal(openWithoutOffers(stale, now), true);
  assert.equal(openWithoutOffers(offered, now), false);
  assert.equal(paymentNearDeadline(due, now), true);
  const counts = dashboardCounts([quoted, stale, offered, due], [], now);
  assert.equal(counts.quotes, 1);
  assert.equal(counts.quotesSoon, 1);
  assert.equal(counts.open, 2);
  assert.equal(counts.openStale, 1);
  assert.equal(counts.awaitingPayment, 1);
  assert.equal(counts.soonestPaymentDue, "2026-10-22T16:10:00.000Z");
  assert.equal(counts.needsAction, 3);
});

test("filters search city and job id without dropping the stage", () => {
  const jobs = [
    job({ pickupArea: "Austell 30168", status: "open" }),
    job({
      id: "22222222-2222-4222-8222-222222222222",
      pickupArea: "Lithia Springs 30122",
      status: "requested",
      service: "junk",
    }),
  ];
  const openOnly = filterJobs(jobs, {
    q: "30168",
    status: "",
    service: "",
    pricing: "",
    zone: "",
    sort: "newest",
    stage: "jobs",
    payment: "",
  });
  assert.equal(openOnly.length, 1);
  const byId = filterJobs(jobs, {
    q: "22222222",
    status: "",
    service: "",
    pricing: "",
    zone: "",
    sort: "oldest",
    stage: "",
    payment: "",
  });
  assert.equal(byId.length, 1);
  assert.equal(byId[0]?.service, "junk");
});

test("activity labels stay free of private fields", () => {
  assert.equal(jobEventLabel("status", { from: null, to: "requested", pickup_address: "1 Secret St" }), "Request submitted");
  assert.equal(jobEventLabel("status", { from: "quoted", to: "open" }), "Quote accepted");
  assert.equal(jobEventLabel("quote_accepted", { phone: "+15555550100" }), "Quote accepted");
  assert.equal(jobEventLabel("details_requested", { items: ["size"] }), "Details requested");
  assert.equal(jobEventLabel("details_answered", {}), "Details answered");
  assert.equal(auditLabel("ask_for_details", { items: ["size"], note: "How big is it?" }), "Details requested");
  assert.equal(
    auditLabel("review_driver", { decision: "approve_active", note: "call 555-0100" }),
    "Driver approved",
  );
  assert.equal(auditLabel("update_platform_settings", { platform_bps: 1000 }), "Settings changed");
  assert.equal(auditLabel("unknown", { email: "a@b.com" }), "Admin action recorded");
});

test("times and document flags use a fixed clock", () => {
  assert.equal(waitedLabel("2026-10-22T15:48:00.000Z", now), "12 min ago");
  assert.equal(readableTime("2026-10-22T12:58:00.000Z", now), "Today 8:58 AM");
  assert.equal(readableTime("2026-10-21T20:12:00.000Z", now), "Yesterday 4:12 PM");
  assert.equal(documentExpiresSoon("2026-11-20", now), true);
  assert.equal(documentExpiresSoon("2027-01-01", now), false);
});

test("navigation highlights the jobs board separately from request review", () => {
  assert.equal(adminNavCurrent("/admin", ""), "overview");
  assert.equal(adminNavCurrent("/admin/requests", ""), "requests");
  assert.equal(adminNavCurrent("/admin/requests", "stage=jobs"), "jobs");
  assert.equal(adminNavCurrent("/admin/requests/abc", ""), "requests");
  assert.equal(adminNavCurrent("/admin/drivers", "status=pending_review"), "drivers");
  assert.equal(adminNavCurrent("/admin/settings", ""), "settings");
  assert.equal(adminNavCurrent("/admin/messages", ""), "messages");
  assert.equal(adminNavCurrent("/admin/communications", ""), "communications");
  assert.equal(adminNavCurrent("/admin/customers", ""), "customers");
  assert.equal(adminNavCurrent("/admin/finance", ""), "payments");
  assert.equal(adminNavCurrent("/admin/payments", ""), "payments");
  assert.equal(adminNavCurrent("/admin/feedback", ""), "feedback");
  assert.equal(adminNavCurrent("/admin/feedback/abc", ""), "feedback");
  assert.equal(adminNavCurrent("/admin/accounts", ""), "accounts");
  assert.equal(adminNavCurrent("/admin/test-data", ""), "test");
  assert.equal(adminNavCurrent("/admin/health", ""), "health");
  assert.equal(adminNavCurrent("/admin/blog", ""), "blog");
  assert.equal(adminNavCurrent("/admin/support", ""), "support");
  assert.equal(adminNavCurrent("/admin/blog/new", ""), "blog");
});
