import { defaultFeeSettings, offerBreakdown } from "@/lib/fees";
import { formatCents } from "@/lib/money";
import { transactionalPhone } from "@/lib/phone";

export type AudienceMode = "eligible" | "online" | "off";

export type TransactionalSettings = {
  enabledAt: string | null;
  audience: AudienceMode;
  adminPhone: string | null;
  platformSms: boolean;
  platformBps: number;
  site: string;
  /** While true, only the listed profiles can receive a booking text. */
  pilotOnly: boolean;
  pilotProfileIds: string[];
};

export type BookingNotice = {
  id: string;
  profileId: string;
  jobId: string | null;
  kind: string;
  role: "customer" | "driver" | "admin" | "other";
  isTest: boolean;
  jobIsTest: boolean;
  online: boolean;
  smsEnabled: boolean;
  optedOut: boolean;
  hasConsent: boolean;
  phone: string | null;
  service: string;
  city: string | null;
  urgency: string;
  priceCents: number | null;
  earningsCents: number | null;
  createdAt: string;
  checkedAt: string | null;
};

export type TimerJob = {
  id: string;
  isTest: boolean;
  status: string;
  urgency: string;
  service: string;
  city: string | null;
  priceCents: number | null;
  createdAt: string;
  authorizedAt: string | null;
  acknowledged: boolean;
  offerCount: number;
  driverId: string | null;
  driver: {
    isTest: boolean;
    online: boolean;
    smsEnabled: boolean;
    optedOut: boolean;
    hasConsent: boolean;
    phone: string | null;
  } | null;
};

export type PlannedSms = {
  dedupeKey: string;
  sourceId: string | null;
  profileId: string | null;
  jobId: string | null;
  kind: string;
  body: string;
  phone: string | null;
  status: "queued" | "skipped";
  reason: string | null;
  attempt?: number;
  alreadyClaimed?: boolean;
};

export type SmsOutcome = "accepted" | "temporary" | "rejected" | "ambiguous";

export type SendResult = { ok: boolean; sid: string | null; error: string | null; outcome?: SmsOutcome };

export type TransactionalIo = {
  settings(): Promise<TransactionalSettings>;
  notices(enabledAt: string): Promise<BookingNotice[]>;
  timers(enabledAt: string, now: Date): Promise<PlannedSms[]>;
  claim(plan: PlannedSms): Promise<boolean>;
  send(phone: string, body: string): Promise<SendResult>;
  mark(dedupeKey: string, status: "accepted" | "failed" | "retry", sid: string | null, error: string | null): Promise<void>;
  /** Records that the provider request has started. A later crash is not retried. */
  started?(dedupeKey: string): Promise<void>;
  checked(noticeId: string): Promise<void>;
  /** Rows that had a definite temporary provider failure and no message id. */
  retries?(): Promise<PlannedSms[]>;
  /** Marks queued rows that never received a provider id so a later switch-on cannot send them. */
  suspendUnsent?(): Promise<void>;
};

const serviceNames: Record<string, string> = {
  delivery: "pickup",
  free_item: "free-item pickup",
  junk: "junk removal",
  construction: "store pickup",
};

const customerKinds = new Set([
  "request_received",
  "offer",
  "driver_confirmed",
  "payment_needed",
  "payment_confirmed",
  "payment_failed",
  "en_route",
  "arrived",
  "picked_up",
  "delivered",
  "completed",
  "cancelled",
]);

const driverKinds = new Set([
  "new_job",
  "assigned",
  "payment_confirmed",
  "cancelled",
  "completed",
  "transfer_sent",
  "connect_needed",
]);

export function knownDriverEarnings(input: {
  pricingMethod: string;
  offerCents: number | null;
  driverPayCents: number | null;
  platformBps: number;
}): number | null {
  if (input.driverPayCents != null && input.driverPayCents > 0) return input.driverPayCents;
  if (input.pricingMethod !== "fixed" || input.offerCents == null) return null;
  try {
    return offerBreakdown(input.offerCents, { ...defaultFeeSettings, platformBps: input.platformBps }).driverEarningsCents;
  } catch {
    return null;
  }
}

export function dueNotices<T extends { createdAt: string; checkedAt: string | null }>(rows: T[], enabledAt: string): T[] {
  return rows.filter((row) => row.checkedAt == null && row.createdAt >= enabledAt);
}

export function transactionalProviderStatus(
  value: string | null,
): "accepted" | "delivered" | "undelivered" | "failed" | "unknown" {
  const status = (value ?? "").trim().toLowerCase();
  if (status === "queued" || status === "accepted" || status === "sending" || status === "sent") return "accepted";
  if (status === "delivered") return "delivered";
  if (status === "undelivered") return "undelivered";
  if (status === "failed") return "failed";
  return "unknown";
}

/** A later callback must not erase a delivered, failed, or undelivered result. */
export function nextTransactionalStatus(current: string, incoming: string): string {
  if (current === "delivered" || current === "undelivered" || current === "failed" || current === "skipped") return current;
  if (incoming === "unknown") return current;
  return incoming;
}

function serviceLabel(service: string): string {
  return serviceNames[service] ?? "request";
}

function place(city: string | null): string {
  return city?.trim() || "your area";
}

function urgencyLabel(value: string): string {
  if (value === "asap") return "ASAP";
  if (value === "today") return "Today";
  return value || "Scheduled";
}

function money(cents: number | null): string {
  return cents == null ? "" : ` ${formatCents(cents)}.`;
}

function link(site: string, path: string): string {
  return `${site.replace(/\/$/, "")}${path}`;
}

function queued(plan: Omit<PlannedSms, "status" | "reason" | "phone"> & { phone: string }): PlannedSms {
  return { ...plan, status: "queued", reason: null };
}

function skipped(plan: Omit<PlannedSms, "status" | "reason">, reason: string): PlannedSms {
  return { ...plan, phone: plan.phone, status: "skipped", reason };
}

function personGate(
  notice: BookingNotice,
  settings: TransactionalSettings,
  base: Omit<PlannedSms, "status" | "reason" | "phone">,
): PlannedSms {
  const phone = transactionalPhone(notice.phone);
  if (notice.isTest || notice.jobIsTest) return skipped({ ...base, phone }, "test_account");
  if (settings.pilotOnly && !settings.pilotProfileIds.includes(notice.profileId)) {
    return skipped({ ...base, phone }, "pilot_limited");
  }
  if (!settings.platformSms) return skipped({ ...base, phone }, "platform_off");
  const broadcast = base.kind === "new_job" || base.kind === "admin_followup";
  if (broadcast && settings.audience === "off") return skipped({ ...base, phone }, "audience_off");
  if (broadcast && settings.audience === "online" && !notice.online) {
    return skipped({ ...base, phone }, "audience_online_only");
  }
  if (notice.optedOut) return skipped({ ...base, phone }, "opted_out");
  if (!notice.smsEnabled) return skipped({ ...base, phone }, "preference_off");
  if (!notice.hasConsent) return skipped({ ...base, phone }, "no_consent");
  if (!phone) return skipped({ ...base, phone: null }, "invalid_phone");
  return queued({ ...base, phone });
}

function adminGate(
  settings: TransactionalSettings,
  jobIsTest: boolean,
  base: Omit<PlannedSms, "status" | "reason" | "phone">,
): PlannedSms | null {
  if (jobIsTest) return null;
  const phone = transactionalPhone(settings.adminPhone);
  if (!settings.platformSms) return skipped({ ...base, phone }, "platform_off");
  if (!phone) return skipped({ ...base, phone: null }, "invalid_phone");
  return queued({ ...base, phone });
}

function customerBody(notice: BookingNotice, site: string): { kind: string; body: string; reason: string | null } | null {
  const where = place(notice.city);
  const service = serviceLabel(notice.service);
  const href = link(site, `/jobs/${notice.jobId}`);
  if (notice.kind === "request_received") {
    return { kind: "request_received", body: `Pickuply received your ${service} request in ${where}. We will text you when a driver offers. ${href}`, reason: null };
  }
  if (notice.kind === "offer") {
    return { kind: "offer", body: `A driver offered on your ${service} request in ${where}. Review it: ${href}`, reason: null };
  }
  if (notice.kind === "driver_confirmed") {
    return {
      kind: "driver_selected",
      body: `You chose a driver for your ${service} request in ${where}. Authorize payment to hold the booking: ${href}`,
      reason: null,
    };
  }
  if (notice.kind === "payment_needed") return { kind: "payment_needed", body: "", reason: "combined_with_driver_selected" };
  if (notice.kind === "payment_confirmed") {
    return { kind: "payment_authorized", body: `Payment is authorized for your ${service} request in ${where}. Your driver can start. ${href}`, reason: null };
  }
  if (notice.kind === "payment_failed") {
    return { kind: "payment_failed", body: `Payment was not approved for your ${service} request in ${where}. Try another card: ${href}`, reason: null };
  }
  if (notice.kind === "en_route") return { kind: "en_route", body: `Your driver is on the way for the ${service} in ${where}. ${href}`, reason: null };
  if (notice.kind === "arrived") return { kind: "arrived", body: `Your driver arrived for the pickup in ${where}. ${href}`, reason: null };
  if (notice.kind === "picked_up") return { kind: "picked_up", body: `Your item was picked up in ${where}. ${href}`, reason: null };
  if (notice.kind === "delivered") return { kind: "delivered", body: "", reason: "combined_with_completion" };
  if (notice.kind === "completed") {
    return { kind: "completed", body: `Your ${service} request in ${where} is complete. Confirm it here: ${href}`, reason: null };
  }
  if (notice.kind === "cancelled") {
    return { kind: "cancelled", body: `Your ${service} request in ${where} was cancelled. ${href}`, reason: null };
  }
  return null;
}

function driverBody(notice: BookingNotice, site: string): { kind: string; body: string } | null {
  const where = place(notice.city);
  const service = serviceLabel(notice.service);
  const href = link(site, `/driver/jobs/${notice.jobId}`);
  const earn = notice.earningsCents == null ? "" : ` You earn ${formatCents(notice.earningsCents)}.`;
  if (notice.kind === "new_job") {
    return {
      kind: "new_job",
      body: `New ${service} in ${where}. ${urgencyLabel(notice.urgency)}.${earn} ${href}`,
    };
  }
  if (notice.kind === "assigned") {
    return {
      kind: "driver_selected",
      body: `You were chosen for a ${service} in ${where}. Do not start until Pickuply texts that payment is secured. ${href}`,
    };
  }
  if (notice.kind === "payment_confirmed") {
    return {
      kind: "cleared_to_start",
      body: `Payment is secured for the ${service} in ${where}. You can start the trip. ${href}`,
    };
  }
  if (notice.kind === "cancelled") {
    return { kind: "cancelled", body: `The ${service} in ${where} you were assigned was cancelled. ${href}` };
  }
  if (notice.kind === "completed") {
    return { kind: "completed", body: `The customer confirmed the ${service} in ${where} is complete. ${href}` };
  }
  if (notice.kind === "transfer_sent") {
    return { kind: "payout_sent", body: `Your payout for the ${service} in ${where} was sent to your payout account. ${link(site, "/driver/earnings")}` };
  }
  if (notice.kind === "connect_needed") {
    return { kind: "payout_setup", body: `Pickuply needs you to finish payout setup before earnings can be sent. ${link(site, "/driver/earnings")}` };
  }
  return null;
}

export function planLifecycle(notice: BookingNotice, settings: TransactionalSettings): PlannedSms[] {
  if (!notice.jobId) return [];
  const plans: PlannedSms[] = [];
  if (notice.role === "customer" && customerKinds.has(notice.kind)) {
    const copy = customerBody(notice, settings.site);
    if (copy) {
      const base = {
        dedupeKey: `sms:${copy.kind}:${notice.jobId}:${notice.profileId}`,
        sourceId: notice.id,
        profileId: notice.profileId,
        jobId: notice.jobId,
        kind: copy.kind,
        body: copy.body || "Pickuply update",
      };
      plans.push(copy.reason ? skipped({ ...base, phone: transactionalPhone(notice.phone) }, copy.reason) : personGate(notice, settings, base));
    }
  }
  if (notice.role === "driver" && driverKinds.has(notice.kind)) {
    const copy = driverBody(notice, settings.site);
    if (copy) {
      plans.push(
        personGate(notice, settings, {
          dedupeKey: `sms:${copy.kind}:${notice.jobId}:${notice.profileId}`,
          sourceId: notice.id,
          profileId: notice.profileId,
          jobId: notice.jobId,
          kind: copy.kind,
          body: copy.body,
        }),
      );
    }
  }
  if (notice.kind === "request_received" || notice.kind === "new_request") {
    const admin = adminGate(settings, notice.jobIsTest, {
      dedupeKey: `admin:new:${notice.jobId}`,
      sourceId: notice.id,
      profileId: null,
      jobId: notice.jobId,
      kind: "admin_new_request",
      body: `New ${serviceLabel(notice.service)} request in ${place(notice.city)}. ${urgencyLabel(notice.urgency)}.${money(notice.priceCents)} ${link(settings.site, `/admin/requests/${notice.jobId}`)}`,
    });
    if (admin) plans.push(admin);
  }
  if (notice.kind === "cancelled") {
    const admin = adminGate(settings, notice.jobIsTest, {
      dedupeKey: `admin:cancel:${notice.jobId}`,
      sourceId: notice.id,
      profileId: null,
      jobId: notice.jobId,
      kind: "admin_cancelled",
      body: `Cancelled ${serviceLabel(notice.service)} request in ${place(notice.city)}. ${urgencyLabel(notice.urgency)}.${money(notice.priceCents)} ${link(settings.site, `/admin/requests/${notice.jobId}`)}`,
    });
    if (admin) plans.push(admin);
  }
  return plans;
}

export function planFollowup(notice: BookingNotice, settings: TransactionalSettings, nonce: string): PlannedSms | null {
  if (notice.role !== "driver" || notice.kind !== "new_job" || !notice.jobId) return null;
  const earn = notice.earningsCents == null ? "" : ` You earn ${formatCents(notice.earningsCents)}.`;
  return personGate(notice, settings, {
    dedupeKey: `followup:${notice.jobId}:${notice.profileId}:${nonce}`,
    sourceId: null,
    profileId: notice.profileId,
    jobId: notice.jobId,
    kind: "admin_followup",
    body: `Follow-up: a ${serviceLabel(notice.service)} in ${place(notice.city)} is still open.${earn} ${link(settings.site, `/driver/jobs/${notice.jobId}`)}`,
  });
}

function minutesAfter(iso: string | null, minutes: number, now: Date): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() + minutes * 60_000 <= now.getTime();
}

export function planNoOffer(job: TimerJob, settings: TransactionalSettings, now: Date): PlannedSms | null {
  if (job.isTest || job.urgency !== "asap" || job.status !== "open" || job.offerCount > 0) return null;
  if (!minutesAfter(job.createdAt, 15, now)) return null;
  return adminGate(settings, false, {
    dedupeKey: `admin:no-offer:${job.id}`,
    sourceId: null,
    profileId: null,
    jobId: job.id,
    kind: "admin_no_offer",
    body: `ASAP ${serviceLabel(job.service)} in ${place(job.city)} has no offer after 15 minutes.${money(job.priceCents)} ${link(settings.site, `/admin/requests/${job.id}`)}`,
  });
}

export function planAckReminder(job: TimerJob, settings: TransactionalSettings, now: Date): PlannedSms | null {
  if (job.status !== "assigned") return null;
  if (job.isTest || job.urgency !== "asap" || job.acknowledged || !job.driverId || !job.driver) return null;
  if (!minutesAfter(job.authorizedAt, 10, now)) return null;
  const driver: BookingNotice = {
    id: `ack:${job.id}`,
    profileId: job.driverId,
    jobId: job.id,
    kind: "ack_reminder",
    role: "driver",
    isTest: job.driver.isTest,
    jobIsTest: job.isTest,
    online: job.driver.online,
    smsEnabled: job.driver.smsEnabled,
    optedOut: job.driver.optedOut,
    hasConsent: job.driver.hasConsent,
    phone: job.driver.phone,
    service: job.service,
    city: job.city,
    urgency: job.urgency,
    priceCents: job.priceCents,
    earningsCents: null,
    createdAt: job.authorizedAt ?? job.createdAt,
    checkedAt: null,
  };
  return personGate(driver, settings, {
    dedupeKey: `ack-reminder:${job.id}:${job.driverId}`,
    sourceId: null,
    profileId: job.driverId,
    jobId: job.id,
    kind: "ack_reminder",
    body: `ASAP ${serviceLabel(job.service)} in ${place(job.city)} is waiting for you to tap I'm on it. ${link(settings.site, `/driver/jobs/${job.id}`)}`,
  });
}

export function planAdminAck(job: TimerJob, settings: TransactionalSettings, now: Date): PlannedSms | null {
  if (job.status !== "assigned") return null;
  if (job.isTest || job.urgency !== "asap" || job.acknowledged) return null;
  if (!minutesAfter(job.authorizedAt, 20, now)) return null;
  return adminGate(settings, false, {
    dedupeKey: `admin:no-ack:${job.id}`,
    sourceId: null,
    profileId: null,
    jobId: job.id,
    kind: "admin_no_ack",
    body: `ASAP ${serviceLabel(job.service)} in ${place(job.city)} has not been acknowledged 20 minutes after payment.${money(job.priceCents)} ${link(settings.site, `/admin/requests/${job.id}`)}`,
  });
}

/** A provider id, a rejection, or a lost response is never sent again. A temporary refusal can be tried once more. */
export function resolveSmsOutcome(result: SendResult): SmsOutcome {
  if (result.outcome) return result.outcome;
  if (result.ok && result.sid) return "accepted";
  if (result.ok) return "ambiguous";
  return "rejected";
}

/** One batch of new-job texts. AT&T accepts this campaign at 0.25 messages per second, so a full driver list stays on later passes. */
export const transactionalBulkBatch = 8;

export const followupWindowMs = 15 * 60 * 1000;

export function followupWindow(now: Date): string {
  return String(Math.floor(now.getTime() / followupWindowMs));
}

export function followupWindowStart(now: Date): string {
  return new Date(Math.floor(now.getTime() / followupWindowMs) * followupWindowMs).toISOString();
}

export function transactionalRank(kind: string): number {
  switch (kind) {
    case "payment_authorized":
    case "cleared_to_start":
      return 0;
    case "cancelled":
    case "admin_cancelled":
      return 1;
    case "driver_selected":
    case "offer":
      return 2;
    case "admin_new_request":
    case "admin_no_offer":
      return 3;
    case "ack_reminder":
    case "admin_no_ack":
      return 4;
    case "new_job":
    case "admin_followup":
      return 8;
    default:
      return 5;
  }
}

export function isBulkTransactional(kind: string): boolean {
  return kind === "new_job" || kind === "admin_followup";
}

export function smsRetryDecision(outcome: SmsOutcome, attempt: number): "accept" | "retry" | "fail" {
  if (outcome === "accepted") return "accept";
  if (outcome === "temporary" && attempt < 2) return "retry";
  return "fail";
}

async function deliver(io: TransactionalIo, plan: PlannedSms, counts: { sent: number; skipped: number; failed: number }) {
  if (!plan.alreadyClaimed) {
    let claimed = false;
    try {
      claimed = await io.claim(plan);
    } catch {
      return;
    }
    if (!claimed) return;
  }
  if (plan.status === "skipped") {
    counts.skipped += 1;
    return;
  }
  const attempt = plan.attempt ?? 1;
  try {
    await io.started?.(plan.dedupeKey);
    const result = await io.send(plan.phone ?? "", plan.body);
    const decision = smsRetryDecision(resolveSmsOutcome(result), attempt);
    if (decision === "accept") {
      await io.mark(plan.dedupeKey, "accepted", result.sid, null);
      counts.sent += 1;
      return;
    }
    if (decision === "retry") {
      await io.mark(plan.dedupeKey, "retry", null, result.error);
      counts.failed += 1;
      return;
    }
    await io.mark(plan.dedupeKey, "failed", null, result.error ?? "provider_rejected");
    counts.failed += 1;
  } catch {
    await io.mark(plan.dedupeKey, "failed", null, "ambiguous_no_response").catch(() => undefined);
    counts.failed += 1;
  }
}

/** Sends an admin follow-up without using the automatic new-job key. */
export async function deliverPlans(
  io: TransactionalIo,
  plans: PlannedSms[],
): Promise<{ sent: number; skipped: number; failed: number }> {
  const counts = { sent: 0, skipped: 0, failed: 0 };
  for (const plan of plans) await deliver(io, plan, counts);
  return counts;
}

/** Sends each planned text once. A provider failure is counted and does not throw. */
export async function runTransactionalPass(io: TransactionalIo, now: Date): Promise<{ sent: number; skipped: number; failed: number }> {
  const settings = await io.settings();
  const counts = { sent: 0, skipped: 0, failed: 0 };
  if (!settings.enabledAt) {
    await io.suspendUnsent?.();
    return counts;
  }
  const notices = dueNotices(await io.notices(settings.enabledAt), settings.enabledAt);
  const items: { plan: PlannedSms; noticeId: string | null }[] = [];
  for (const notice of notices) {
    for (const plan of planLifecycle(notice, settings)) items.push({ plan, noticeId: notice.id });
  }
  for (const plan of await io.timers(settings.enabledAt, now)) items.push({ plan, noticeId: null });
  for (const plan of (await io.retries?.()) ?? []) {
    items.push({ plan: { ...plan, alreadyClaimed: true }, noticeId: null });
  }
  items.sort((left, right) => transactionalRank(left.plan.kind) - transactionalRank(right.plan.kind));
  const deferred = new Set<string>();
  let bulk = 0;
  for (const item of items) {
    const holdForLater = isBulkTransactional(item.plan.kind) && !item.plan.alreadyClaimed && bulk >= transactionalBulkBatch;
    if (holdForLater) {
      if (item.noticeId) deferred.add(item.noticeId);
      continue;
    }
    if (isBulkTransactional(item.plan.kind) && !item.plan.alreadyClaimed) bulk += 1;
    await deliver(io, item.plan, counts);
  }
  for (const notice of notices) {
    if (!deferred.has(notice.id)) await io.checked(notice.id).catch(() => undefined);
  }
  return counts;
}
