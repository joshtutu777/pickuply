import { fees, pricingMethods, serviceById, type ServiceId } from "@/lib/constants";
import { formatCents, formatDollarRange } from "@/lib/money";

export const activeJobStatuses = [
  "assigned",
  "en_route",
  "arrived",
  "item_check",
  "in_transit",
  "delivered",
] as const;

export const jobBoardStatuses = ["open", ...activeJobStatuses] as const;

export const quoteSoonMs = 2 * 60 * 60 * 1000;
export const openWaitMs = 20 * 60 * 1000;
export const paymentSoonMs = 15 * 60 * 1000;
export const documentSoonMs = 30 * 24 * 60 * 60 * 1000;

const specialtyPattern = /\b(piano|gun safe|pool table|hot tub|safe)\b/i;

const statusLabels: Record<string, string> = {
  requested: "Requested",
  in_review: "In review",
  quoted: "Quoted",
  open: "Open for drivers",
  assigned: "Driver assigned",
  en_route: "Driver on the way",
  arrived: "Driver arrived",
  item_check: "Item check",
  in_transit: "On the way",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
  disputed: "Disputed",
};

const paymentLabels: Record<string, string> = {
  none: "Not started",
  awaiting_payment: "Awaiting payment",
  authorized: "Authorized",
  paid: "Paid",
  captured: "Captured",
  canceled: "Canceled",
  failed: "Failed",
  refunded: "Refunded",
};

const knownStatuses = new Set(Object.keys(statusLabels));
const reviewActions = new Set(["publish", "quote", "changes", "decline"]);
const driverDecisions = new Set([
  "approve_new",
  "approve_active",
  "request_changes",
  "decline",
  "pause",
  "remove",
]);

export type AdminJob = {
  id: string;
  service: string;
  status: string;
  createdAt: string;
  pricingMethod: string;
  pickupArea: string;
  zoneId: string | null;
  paymentStatus: string | null;
  paymentDueAt: string | null;
  quoteExpiresAt: string | null;
  assignedDriverId: string | null;
  customerId: string | null;
  preferredDate: string;
  itemValueCents: number | null;
  detailsOpen?: boolean;
  offerCents: number | null;
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  priceCents: number | null;
  openedAt: string | null;
  quotedAt: string | null;
  offerCount: number;
  hasRequestPhotos: boolean;
  overThousand: boolean;
  specialty: boolean;
};

export type AdminDriver = {
  id: string;
  status: string;
  homeCity: string | null;
  zoneId: string | null;
  online: boolean;
  licenseExpires: string | null;
  insuranceExpires: string | null;
  createdAt: string;
  name: string | null;
  needsChanges?: boolean;
  coverage?: string | null;
};

export type NeedsActionItem = {
  id: string;
  kind: "request" | "driver" | "open" | "quote" | "payment";
  href: string;
  title: string;
  service: string;
  pricingMethod: string;
  area: string;
  since: string;
  badges: string[];
  action: string;
};

export type ActivityItem = {
  id: string;
  at: string;
  actor: string;
  label: string;
  href: string | null;
};

export type RequestFilters = {
  q: string;
  status: string;
  service: string;
  pricing: string;
  zone: string;
  sort: "newest" | "oldest";
  stage: "" | "jobs" | "active";
  payment: string;
};

export function adminTabTitle(count: number): string {
  return count > 0 ? `(${count}) Pickuply Admin` : "Pickuply Admin";
}

export function jobStatusLabel(status: string): string {
  return statusLabels[status] ?? "Updated";
}

export function paymentStatusLabel(status: string | null): string {
  if (!status) return "Not started";
  return paymentLabels[status] ?? "Updated";
}

export function pricingMethodLabel(method: string): string {
  return pricingMethods.find((item) => item.id === method)?.label ?? "Pricing";
}

export function serviceLabel(service: string): string {
  if (service === "delivery" || service === "junk" || service === "free_item" || service === "construction") {
    return serviceById(service as ServiceId).name;
  }
  return "Request";
}

export function pricingAmount(job: Pick<AdminJob, "pricingMethod" | "priceCents" | "offerCents" | "budgetMinCents" | "budgetMaxCents">): string | null {
  if (job.priceCents != null) return formatCents(job.priceCents);
  if (job.pricingMethod === "fixed" && job.offerCents != null) return formatCents(job.offerCents);
  if (job.pricingMethod === "range" && job.budgetMinCents != null && job.budgetMaxCents != null) {
    return formatDollarRange(job.budgetMinCents, job.budgetMaxCents);
  }
  return null;
}

export function firstName(fullName: string | null | undefined): string | null {
  const trimmed = fullName?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] || null;
}

export function actorLabel(role: string | null, fullName: string | null): string {
  const roleName = role === "admin" ? "Admin" : role === "driver" ? "Driver" : role === "customer" ? "Customer" : "Pickuply";
  const name = firstName(fullName);
  return name ? `${roleName} ${name}` : roleName;
}

export function waitedLabel(iso: string, now: number): string {
  const delta = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function readableTime(iso: string, now: number, timeZone = "America/New_York"): string {
  const date = new Date(iso);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  const dayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = dayKey.format(date);
  const today = dayKey.format(new Date(now));
  const yesterday = dayKey.format(new Date(now - 24 * 60 * 60 * 1000));
  if (day === today) return `Today ${time}`;
  if (day === yesterday) return `Yesterday ${time}`;
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(date);
  return `${datePart}, ${time}`;
}

export function isOverThousand(itemValueCents: number | null): boolean {
  return (itemValueCents ?? 0) > fees.itemValueCapCents;
}

export function isSpecialty(description: string, specialItems: unknown): boolean {
  if (specialtyPattern.test(description)) return true;
  if (!specialItems || typeof specialItems !== "object") return false;
  return Object.values(specialItems as Record<string, unknown>).some((value) => value === true);
}

export function documentExpiresSoon(day: string | null, now: number): boolean {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const expires = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(expires) && expires <= now + documentSoonMs;
}

export function quoteExpiresSoon(job: AdminJob, now: number): boolean {
  if (job.status !== "quoted" || !job.quoteExpiresAt) return false;
  return new Date(job.quoteExpiresAt).getTime() <= now + quoteSoonMs;
}

export function openWithoutOffers(job: AdminJob, now: number): boolean {
  if (job.status !== "open" || job.offerCount > 0) return false;
  const opened = new Date(job.openedAt ?? job.createdAt).getTime();
  return now - opened >= openWaitMs;
}

export function paymentNearDeadline(job: AdminJob, now: number): boolean {
  if (job.status !== "assigned" || job.paymentStatus !== "awaiting_payment" || !job.paymentDueAt) return false;
  return new Date(job.paymentDueAt).getTime() <= now + paymentSoonMs;
}

export function isNewRequest(job: AdminJob): boolean {
  return job.status === "requested" || job.status === "in_review";
}

export function jobBadges(job: AdminJob): string[] {
  const badges: string[] = [];
  if (job.overThousand) badges.push("Over $1,000");
  if (job.specialty) badges.push("Specialty item");
  if (job.preferredDate === "asap") badges.push("ASAP");
  if (job.hasRequestPhotos) badges.push("Has photos");
  return badges;
}

export function needsAction(jobs: AdminJob[], drivers: AdminDriver[], now: number): NeedsActionItem[] {
  const items: NeedsActionItem[] = [];
  for (const job of jobs) {
    if (isNewRequest(job) && !job.detailsOpen) {
      items.push(actionItem(job, "request", job.createdAt, "Review request"));
    }
    if (openWithoutOffers(job, now)) {
      items.push(actionItem(job, "open", job.openedAt ?? job.createdAt, "Review request"));
    }
    if (quoteExpiresSoon(job, now)) {
      items.push(actionItem(job, "quote", job.quotedAt ?? job.createdAt, "Review request"));
    }
    if (paymentNearDeadline(job, now)) {
      items.push(actionItem(job, "payment", job.paymentDueAt ?? job.createdAt, "Review request"));
    }
  }
  for (const driver of drivers) {
    if (driver.status !== "pending_review") continue;
    items.push({
      id: `driver-${driver.id}`,
      kind: "driver",
      href: `/admin/drivers/${driver.id}`,
      title: driver.name ? firstName(driver.name) ?? "Applicant" : "Applicant",
      service: "Driver application",
      pricingMethod: "Application",
      area: driver.homeCity || "No city",
      since: driver.createdAt,
      badges: [],
      action: "Review driver",
    });
  }
  return items.sort((left, right) => left.since.localeCompare(right.since) || left.id.localeCompare(right.id));
}

function actionItem(job: AdminJob, kind: NeedsActionItem["kind"], since: string, action: string): NeedsActionItem {
  return {
    id: `${kind}-${job.id}`,
    kind,
    href: `/admin/requests/${job.id}`,
    title: serviceLabel(job.service),
    service: serviceLabel(job.service),
    pricingMethod: pricingMethodLabel(job.pricingMethod),
    area: job.pickupArea,
    since,
    badges: jobBadges(job),
    action,
  };
}

export function soonestPaymentDue(jobs: AdminJob[]): string | null {
  const dues = jobs
    .filter((job) => job.paymentStatus === "awaiting_payment" && job.paymentDueAt)
    .map((job) => job.paymentDueAt as string)
    .sort();
  return dues[0] ?? null;
}

export type DashboardCounts = {
  total: number;
  newRequests: number;
  quotes: number;
  quotesSoon: number;
  open: number;
  openStale: number;
  active: number;
  awaitingPayment: number;
  soonestPaymentDue: string | null;
  completed: number;
  pendingDrivers: number;
  needsAction: number;
};

export function dashboardCounts(jobs: AdminJob[], drivers: AdminDriver[], now: number): DashboardCounts {
  const action = needsAction(jobs, drivers, now);
  return {
    total: jobs.length,
    newRequests: jobs.filter(isNewRequest).length,
    quotes: jobs.filter((job) => job.status === "quoted").length,
    quotesSoon: jobs.filter((job) => quoteExpiresSoon(job, now)).length,
    open: jobs.filter((job) => job.status === "open").length,
    openStale: jobs.filter((job) => openWithoutOffers(job, now)).length,
    active: jobs.filter((job) => activeJobStatuses.includes(job.status as (typeof activeJobStatuses)[number])).length,
    awaitingPayment: jobs.filter((job) => job.paymentStatus === "awaiting_payment").length,
    soonestPaymentDue: soonestPaymentDue(jobs),
    completed: jobs.filter((job) => job.status === "completed").length,
    pendingDrivers: drivers.filter((driver) => driver.status === "pending_review").length,
    needsAction: action.length,
  };
}

export function parseRequestFilters(input: {
  q?: string | string[];
  status?: string | string[];
  service?: string | string[];
  pricing?: string | string[];
  zone?: string | string[];
  sort?: string | string[];
  stage?: string | string[];
  payment?: string | string[];
}): RequestFilters {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const sort = one(input.sort);
  const stage = one(input.stage);
  return {
    q: one(input.q).trim(),
    status: one(input.status),
    service: one(input.service),
    pricing: one(input.pricing),
    zone: one(input.zone),
    sort: sort === "oldest" ? "oldest" : "newest",
    stage: stage === "jobs" || stage === "active" ? stage : "",
    payment: one(input.payment),
  };
}

export function filterJobs(jobs: AdminJob[], filters: RequestFilters): AdminJob[] {
  const query = filters.q.toLowerCase();
  const filtered = jobs.filter((job) => {
    if (filters.stage === "jobs" && !jobBoardStatuses.includes(job.status as (typeof jobBoardStatuses)[number]) && !filters.status) {
      return false;
    }
    if (filters.stage === "active" && !activeJobStatuses.includes(job.status as (typeof activeJobStatuses)[number]) && !filters.status) {
      return false;
    }
    if (filters.status === "new" && !isNewRequest(job)) return false;
    if (filters.status && filters.status !== "new" && job.status !== filters.status) return false;
    if (filters.service && job.service !== filters.service) return false;
    if (filters.pricing && job.pricingMethod !== filters.pricing) return false;
    if (filters.zone && job.zoneId !== filters.zone) return false;
    if (filters.payment && (job.paymentStatus ?? "none") !== filters.payment) return false;
    if (!query) return true;
    const area = job.pickupArea.toLowerCase();
    return area.includes(query) || job.id.toLowerCase().includes(query);
  });
  const direction = filters.sort === "oldest" ? 1 : -1;
  return filtered.sort((left, right) => left.createdAt.localeCompare(right.createdAt) * direction || left.id.localeCompare(right.id));
}

export function driverQueueLabel(driver: AdminDriver): string {
  if (driver.status === "removed") return "Removed";
  if (driver.status === "paused") return "Paused";
  if (driver.status === "active" || driver.status === "approved_new") return "Active";
  if (driver.needsChanges) return "Needs changes";
  if (!driver.licenseExpires || !driver.insuranceExpires) return "Pending documents";
  return "New application";
}

export function sortDriverQueue(drivers: AdminDriver[]): AdminDriver[] {
  const pending = (driver: AdminDriver) => driver.status === "pending_review" || driver.status === "applied";
  return [...drivers].sort((left, right) => {
    const rank = Number(pending(right)) - Number(pending(left));
    if (rank !== 0) return rank;
    return right.createdAt.localeCompare(left.createdAt);
  });
}

export function noDriverCutoffIso(): string {
  return new Date(Date.now() - 20 * 60 * 1000).toISOString();
}

export function waitLabel(createdAt: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(createdAt)) / 60000));
  if (minutes < 60) return `Waiting ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Waiting ${hours} hr`;
  return `Waiting ${Math.round(hours / 24)} days`;
}

export function filterDrivers(
  drivers: AdminDriver[],
  input: { status?: string; online?: string; zone?: string },
): AdminDriver[] {
  return drivers.filter((driver) => {
    if (input.status && driver.status !== input.status) return false;
    if (input.online === "1" && !driver.online) return false;
    if (input.zone && driver.zoneId !== input.zone) return false;
    return true;
  });
}

export function onlineByZone(drivers: AdminDriver[], zoneNames: Map<string, string>): { zoneId: string | null; name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const driver of drivers) {
    if (!driver.online) continue;
    const key = driver.zoneId ?? "";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      zoneId: key || null,
      name: key ? zoneNames.get(key) ?? "Zone" : "No zone",
      count,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function adminNavCurrent(pathname: string, search: string): "overview" | "requests" | "jobs" | "drivers" | "settings" | "payments" | "payouts" | "funnel" | "help" | "feedback" | "messages" | "alerts" | "accounts" | "communications" | "customers" | "test" | "health" {
  if (pathname === "/admin") return "overview";
  if (pathname.startsWith("/admin/feedback")) return "feedback";
  if (pathname.startsWith("/admin/notifications")) return "alerts";
  if (pathname.startsWith("/admin/communications")) return "communications";
  if (pathname.startsWith("/admin/customers")) return "customers";
  if (pathname.startsWith("/admin/messages")) return "messages";
  if (pathname.startsWith("/admin/help")) return "help";
  if (pathname.startsWith("/admin/funnel")) return "funnel";
  if (pathname.startsWith("/admin/drivers")) return "drivers";
  if (pathname.startsWith("/admin/test-data")) return "test";
  if (pathname.startsWith("/admin/health")) return "health";
  if (pathname.startsWith("/admin/accounts")) return "accounts";
  if (pathname.startsWith("/admin/settings")) return "settings";
  if (pathname.startsWith("/admin/finance") || pathname.startsWith("/admin/payments")) return "payments";
  if (pathname.startsWith("/admin/payouts")) return "payouts";
  const stage = new URLSearchParams(search).get("stage");
  if (stage === "jobs" || stage === "active") return "jobs";
  return "requests";
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function allowed(value: unknown, choices: Set<string>): string | null {
  return typeof value === "string" && choices.has(value) ? value : null;
}

export function jobEventLabel(type: string, data: unknown): string {
  const body = record(data);
  const to = allowed(body?.to, knownStatuses);
  const from = allowed(body?.from, knownStatuses);
  if (type === "details_requested") return "Details requested";
  if (type === "details_answered") return "Details answered";
  if (type === "quote_accepted") return "Quote accepted";
  if (type === "claimed" || type === "offer_chosen") return "Driver assigned";
  if (type === "status" && to === "requested") return "Request submitted";
  if (type === "status" && to === "quoted") return "Quote sent";
  if (type === "status" && to === "open" && from === "quoted") return "Quote accepted";
  if (type === "status" && to === "open") return "Job published";
  if (type === "status" && to === "assigned") return "Driver assigned";
  if (type === "status" && to) return `Status changed to ${jobStatusLabel(to)}`;
  return "Job updated";
}

export function auditLabel(action: string, data: unknown): string {
  const body = record(data);
  const review = allowed(body?.action, reviewActions);
  const decision = allowed(body?.decision, driverDecisions);
  if (action === "review_request" && review === "publish") return "Job published";
  if (action === "review_request" && review === "quote") return "Quote sent";
  if (action === "review_request" && review === "changes") return "Changes requested";
  if (action === "review_request" && review === "decline") return "Request declined";
  if (action === "ask_for_details") return "Details requested";
  if (action === "review_driver" && (decision === "approve_new" || decision === "approve_active")) return "Driver approved";
  if (action === "review_driver" && decision === "pause") return "Driver paused";
  if (action === "review_driver") return "Driver reviewed";
  if (action === "resolve_dispute") return "Problem report resolved";
  if (action === "update_proof_rules") return "Proof rules changed";
  if (action === "set_proof_location_enabled") return "Proof location setting changed";
  if (action === "set_disposal_receipt") return "Disposal receipt requirement changed";
  if (action === "set_support_contact") return "Support contact changed";
  if (action === "set_sms_enabled") return "Text message setting changed";
  if (action === "update_platform_settings" || action === "set_waves_enabled" || action === "update_offer_minimums") {
    return "Settings changed";
  }
  if (action === "invite_driver") return "Driver invited";
  if (action === "set_payment_status") return "Payment status changed";
  if (action === "approve_vehicle") return "Vehicle approved";
  return "Admin action recorded";
}

export function activityHref(targetType: string | null, targetId: string | null): string | null {
  if (!targetId) return targetType === "platform_settings" ? "/admin/settings" : null;
  if (targetType === "job") return `/admin/requests/${targetId}`;
  if (targetType === "driver") return `/admin/drivers/${targetId}`;
  if (targetType === "platform_settings") return "/admin/settings";
  return null;
}
