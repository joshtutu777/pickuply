import assert from "node:assert/strict";
import test from "node:test";
import {
  dueNotices,
  knownDriverEarnings,
  nextTransactionalStatus,
  planAckReminder,
  planAdminAck,
  planFollowup,
  planLifecycle,
  planNoOffer,
  runTransactionalPass,
  transactionalProviderStatus,
  type BookingNotice,
  type PlannedSms,
  type TimerJob,
  type TransactionalIo,
  type TransactionalSettings,
} from "./transactional";

const settings: TransactionalSettings = {
  enabledAt: "2026-11-26T18:00:00.000Z",
  audience: "eligible",
  adminPhone: "15555550199",
  platformSms: true,
  platformBps: 1500,
  site: "https://pickuplyapp.com",
};

function notice(overrides: Partial<BookingNotice> = {}): BookingNotice {
  return {
    id: "notice-1",
    profileId: "profile-1",
    jobId: "job-1",
    kind: "request_received",
    role: "customer",
    isTest: false,
    jobIsTest: false,
    online: false,
    smsEnabled: true,
    optedOut: false,
    hasConsent: true,
    phone: "15555550100",
    service: "free_item",
    city: "Marietta",
    urgency: "asap",
    priceCents: 4000,
    earningsCents: 3400,
    createdAt: "2026-11-26T18:05:00.000Z",
    checkedAt: null,
    ...overrides,
  };
}

function job(overrides: Partial<TimerJob> = {}): TimerJob {
  return {
    id: "job-1",
    isTest: false,
    status: "assigned",
    urgency: "asap",
    service: "free_item",
    city: "Marietta",
    priceCents: 4000,
    createdAt: "2026-11-26T18:00:00.000Z",
    authorizedAt: "2026-11-26T18:00:00.000Z",
    acknowledged: false,
    offerCount: 0,
    driverId: "driver-1",
    driver: {
      isTest: false,
      online: false,
      smsEnabled: true,
      optedOut: false,
      hasConsent: true,
      phone: "15555550101",
    },
    ...overrides,
  };
}

test("quote jobs do not get an invented earnings amount", () => {
  assert.equal(knownDriverEarnings({ pricingMethod: "quote", offerCents: null, driverPayCents: null, platformBps: 1500 }), null);
  assert.equal(knownDriverEarnings({ pricingMethod: "fixed", offerCents: 4000, driverPayCents: null, platformBps: 1500 }), 3400);
  assert.equal(knownDriverEarnings({ pricingMethod: "fixed", offerCents: 4000, driverPayCents: 3400, platformBps: 1500 }), 3400);
});

test("old and already checked alerts are not sent again", () => {
  const rows = [
    notice({ id: "old", createdAt: "2026-11-26T17:00:00.000Z" }),
    notice({ id: "done", checkedAt: "2026-11-26T18:06:00.000Z" }),
    notice({ id: "new" }),
  ];
  assert.deepEqual(dueNotices(rows, settings.enabledAt!).map((row) => row.id), ["new"]);
});

test("a stored 11-digit number is texted and an invalid number is skipped", () => {
  const sent = planLifecycle(notice(), settings);
  assert.equal(sent[0]?.phone, "+15555550100");
  assert.equal(sent[0]?.status, "queued");
  const skipped = planLifecycle(notice({ phone: "0000000000" }), settings);
  assert.equal(skipped[0]?.status, "skipped");
  assert.equal(skipped[0]?.reason, "invalid_phone");
});

test("selecting a driver and securing payment stay two different driver texts", () => {
  const selected = planLifecycle(notice({ role: "driver", kind: "assigned", earningsCents: null }), settings)[0];
  const cleared = planLifecycle(notice({ role: "driver", kind: "payment_confirmed", earningsCents: null }), settings)[0];
  assert.match(selected?.body ?? "", /Do not start/);
  assert.equal(selected?.body.includes("can start"), false);
  assert.match(cleared?.body ?? "", /You can start the trip/);
  assert.notEqual(selected?.dedupeKey, cleared?.dedupeKey);
});

test("the customer gets one selection text that includes the payment step", () => {
  const selected = planLifecycle(notice({ kind: "driver_confirmed" }), settings)[0];
  const payment = planLifecycle(notice({ kind: "payment_needed" }), settings)[0];
  const delivered = planLifecycle(notice({ kind: "delivered" }), settings)[0];
  assert.match(selected?.body ?? "", /Authorize payment/);
  assert.equal(payment?.status, "skipped");
  assert.equal(payment?.reason, "combined_with_driver_selected");
  assert.equal(delivered?.reason, "combined_with_completion");
});

test("a new job text includes earnings only when they are known and reaches an offline driver", () => {
  const priced = planLifecycle(notice({ role: "driver", kind: "new_job", online: false }), settings)[0];
  const quote = planLifecycle(notice({ role: "driver", kind: "new_job", earningsCents: null, online: false }), settings)[0];
  assert.match(priced?.body ?? "", /You earn \$34/);
  assert.equal(quote?.body.includes("You earn"), false);
  assert.equal(priced?.status, "queued");
  const narrowed = planLifecycle(notice({ role: "driver", kind: "new_job", online: false }), { ...settings, audience: "online" })[0];
  assert.equal(narrowed?.reason, "audience_online_only");
});

test("test requests, opt-outs, and a missing preference do not send", () => {
  assert.equal(planLifecycle(notice({ jobIsTest: true }), settings).find((plan) => plan.kind === "admin_new_request"), undefined);
  assert.equal(planLifecycle(notice({ isTest: true }), settings)[0]?.reason, "test_account");
  assert.equal(planLifecycle(notice({ optedOut: true }), settings)[0]?.reason, "opted_out");
  assert.equal(planLifecycle(notice({ smsEnabled: false }), settings)[0]?.reason, "preference_off");
  assert.equal(planLifecycle(notice({ hasConsent: false }), settings)[0]?.reason, "no_consent");
});

test("an admin follow-up uses a different key from the first new-job text", () => {
  const first = planLifecycle(notice({ role: "driver", kind: "new_job" }), settings)[0];
  const follow = planFollowup(notice({ role: "driver", kind: "new_job" }), settings, "click-1");
  assert.equal(first?.kind, "new_job");
  assert.equal(follow?.kind, "admin_followup");
  assert.notEqual(first?.dedupeKey, follow?.dedupeKey);
});

test("ASAP reminders wait 10 and 20 minutes and do not fire after acknowledgment", () => {
  const now = new Date("2026-11-26T18:21:00.000Z");
  const waiting = job({ authorizedAt: "2026-11-26T18:00:00.000Z" });
  assert.equal(planAckReminder(waiting, settings, new Date("2026-11-26T18:09:00.000Z")), null);
  assert.equal(planAckReminder(waiting, settings, now)?.kind, "ack_reminder");
  assert.equal(planAdminAck(waiting, settings, new Date("2026-11-26T18:19:00.000Z")), null);
  assert.equal(planAdminAck(waiting, settings, now)?.kind, "admin_no_ack");
  assert.equal(planAckReminder(job({ acknowledged: true }), settings, now), null);
  assert.equal(planAdminAck(job({ acknowledged: true }), settings, now), null);
  assert.equal(planAckReminder(job({ urgency: "today" }), settings, now), null);
  const quiet = job({ status: "open", createdAt: "2026-11-26T18:00:00.000Z", offerCount: 0 });
  assert.equal(planNoOffer(quiet, settings, new Date("2026-11-26T18:14:00.000Z")), null);
  assert.equal(planNoOffer(quiet, settings, new Date("2026-11-26T18:16:00.000Z"))?.kind, "admin_no_offer");
  assert.equal(planNoOffer(job({ status: "open", offerCount: 1, createdAt: "2026-11-26T18:00:00.000Z" }), settings, now), null);
});

test("provider statuses stay distinct and a delivered text is not rewritten", () => {
  assert.equal(transactionalProviderStatus("undelivered"), "undelivered");
  assert.equal(transactionalProviderStatus("sent"), "accepted");
  assert.equal(nextTransactionalStatus("delivered", "failed"), "delivered");
  assert.equal(nextTransactionalStatus("accepted", "undelivered"), "undelivered");
});

test("a failed send, a repeat, and two workers do not throw or send twice", async () => {
  const claimed = new Set<string>();
  const sent: string[] = [];
  const rows = [notice({ kind: "payment_confirmed" })];
  const io = fakeIo(rows, claimed, sent, async () => {
    throw new Error("provider down");
  });
  const first = await runTransactionalPass(io, new Date("2026-11-26T18:10:00.000Z"));
  assert.equal(first.failed, 1);
  assert.equal(sent.length, 1);
  rows[0] = notice({ kind: "payment_confirmed", checkedAt: "2026-11-26T18:10:00.000Z" });
  const second = await runTransactionalPass(io, new Date("2026-11-26T18:11:00.000Z"));
  assert.equal(second.sent, 0);

  const open = [notice({ id: "race", kind: "payment_failed" })];
  const shared = new Set<string>();
  const calls: string[] = [];
  const racing = fakeIo(open, shared, calls, async () => ({ ok: true, sid: "SM1", error: null }));
  const [left, right] = await Promise.all([
    runTransactionalPass(racing, new Date("2026-11-26T18:10:00.000Z")),
    runTransactionalPass(racing, new Date("2026-11-26T18:10:00.000Z")),
  ]);
  assert.equal(left.sent + right.sent, 1);
  assert.equal(calls.length, 1);
});

test("turning the feature off sends nothing, including older alerts", async () => {
  const calls: string[] = [];
  const io = fakeIo([notice()], new Set(), calls, async () => ({ ok: true, sid: "SM1", error: null }));
  io.settings = async () => ({ ...settings, enabledAt: null });
  const result = await runTransactionalPass(io, new Date("2026-11-26T18:10:00.000Z"));
  assert.deepEqual(result, { sent: 0, skipped: 0, failed: 0 });
  assert.equal(calls.length, 0);
});

function fakeIo(
  rows: BookingNotice[],
  claimed: Set<string>,
  calls: string[],
  send: TransactionalIo["send"],
): TransactionalIo {
  return {
    settings: async () => settings,
    notices: async () => rows,
    timers: async () => [],
    claim: async (plan: PlannedSms) => {
      if (claimed.has(plan.dedupeKey)) return false;
      claimed.add(plan.dedupeKey);
      return true;
    },
    send: async (phone, body) => {
      calls.push(phone);
      return send(phone, body);
    },
    mark: async () => undefined,
    checked: async (id) => {
      const row = rows.find((item) => item.id === id);
      if (row) row.checkedAt = "2026-11-26T18:10:00.000Z";
    },
  };
}
