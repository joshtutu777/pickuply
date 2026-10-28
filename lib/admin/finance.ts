import { formatCents, parseDollarsToCents } from "@/lib/money";

export const financeTabs = ["overview", "payments", "payouts", "attention", "reconcile"] as const;
export type FinanceTab = (typeof financeTabs)[number];

export const dateRanges = ["today", "yesterday", "week", "last_week", "month", "last_month", "custom"] as const;
export const dateBases = ["requested", "booked", "captured", "refunded", "paid_out"] as const;
export const paymentChips = [
  "awaiting_payment",
  "held",
  "charged",
  "partially_charged",
  "released",
  "refunded",
  "disputed",
  "failed",
] as const;
export const ledgerStatuses = [
  "pending",
  "held",
  "held_until_onboarding",
  "ready",
  "transferred",
  "externally_paid",
  "recovery_due",
  "recovered",
] as const;

export type Money = { cents: number } | { unavailable: true } | { notTracked: true };

export type FinanceJob = {
  id: string;
  customerId: string;
  customerFirst: string | null;
  driverId: string | null;
  driverFirst: string | null;
  service: string;
  pricingMethod: "quote" | "fixed" | "range";
  jobStatus: string;
  paymentStatus: string | null;
  pickupCity: string | null;
  pickupZip: string | null;
  priceCents: number | null;
  driverPayCents: number | null;
  capturedCents: number | null;
  refundedCents: number | null;
  platformFeeCents: number | null;
  serviceFeeCents: number | null;
  tipCents?: number | null;
  stripeFeeCents: number | null;
  tripFeeCents: number | null;
  lateCancelCents: number | null;
  paymentDueAt: string | null;
  captureBefore: string | null;
  createdAt: string;
  jobUpdatedAt: string;
  customerConfirmedAt: string | null;
  bookedAt: string | null;
  capturedAt: string | null;
  refundedAt: string | null;
  paidOutAt: string | null;
  paymentIntentId: string | null;
  ledgerStatus: (typeof ledgerStatuses)[number] | null;
  ledgerAmountCents: number | null;
  transferStatus: "created" | "reversed" | "failed" | null;
  transferId: string | null;
  holdReason: string | null;
  ledgerAvailableOn: string | null;
  openReport: boolean;
  openDispute: boolean;
  payoutsEnabled: boolean | null;
  caseNumber: string | null;
};

export type FinanceFilters = {
  tab: FinanceTab;
  range: (typeof dateRanges)[number];
  from: string;
  to: string;
  date: (typeof dateBases)[number];
  cities: string[];
  zips: string[];
  service: string;
  pricing: string;
  amountMin: string;
  amountMax: string;
  q: string;
  paymentStatus: string;
  fee: string;
  hold: string;
  report: string;
  customer: string;
  ledgerStatus: string;
  transferStatus: string;
  holdReason: string;
  overdue: string;
  driver: string;
  payoutSetup: string;
  issue: string;
  group: string;
  compare: boolean;
  sort: string;
  page: number;
  includeTest?: boolean;
};

export const chipLabel: Record<(typeof paymentChips)[number], string> = {
  awaiting_payment: "Awaiting payment",
  held: "Held",
  charged: "Charged",
  partially_charged: "Partially charged",
  released: "Released",
  refunded: "Refunded",
  disputed: "Disputed",
  failed: "Failed",
};

export const ledgerLabel: Record<(typeof ledgerStatuses)[number], string> = {
  pending: "Pending",
  held: "Held",
  held_until_onboarding: "Held until payout setup",
  ready: "Ready",
  transferred: "Transferred",
  externally_paid: "Paid outside Stripe",
  recovery_due: "Recovery due",
  recovered: "Recovered",
};

const serviceLabel: Record<string, string> = {
  delivery: "Pickup & Delivery",
  free_item: "Free-Item Pickup",
  construction: "Store Delivery",
  junk: "Junk Removal",
};

export function serviceName(id: string): string {
  return serviceLabel[id] ?? id;
}

export function showMoney(value: Money): string {
  if ("notTracked" in value) return "Not tracked";
  if ("unavailable" in value) return "Unavailable";
  return formatCents(value.cents);
}

export function knownCents(value: number | null | undefined): Money {
  if (value == null || !Number.isInteger(value)) return { unavailable: true };
  return { cents: value };
}

export function addMoney(values: Money[]): Money {
  let cents = 0;
  for (const value of values) {
    if ("notTracked" in value) return { notTracked: true };
    if (!("cents" in value)) return { unavailable: true };
    cents += value.cents;
  }
  return { cents };
}

export function paymentChip(job: FinanceJob): (typeof paymentChips)[number] | null {
  if (job.openDispute) return "disputed";
  if (job.paymentStatus === "failed") return "failed";
  if (job.paymentStatus === "awaiting_payment") return "awaiting_payment";
  if (job.paymentStatus === "authorized") return "held";
  if (job.paymentStatus === "canceled") return "released";
  if (job.paymentStatus === "refunded" || (job.refundedCents ?? 0) > 0) return "refunded";
  if (job.paymentStatus === "captured" || job.paymentStatus === "paid") {
    if (job.capturedCents == null || job.priceCents == null) return "charged";
    if (job.capturedCents > 0 && job.capturedCents < job.priceCents) return "partially_charged";
    return "charged";
  }
  return null;
}

export function refundKind(job: FinanceJob): "full" | "partial" | null {
  if ((job.refundedCents ?? 0) <= 0 && job.paymentStatus !== "refunded") return null;
  if (job.refundedCents == null || job.capturedCents == null) return null;
  if (job.refundedCents >= job.capturedCents && job.capturedCents > 0) return "full";
  if (job.refundedCents > 0) return "partial";
  return null;
}

export function isLateCancel(job: FinanceJob): boolean {
  return (job.lateCancelCents ?? 0) > 0;
}

export function isTripFee(job: FinanceJob): boolean {
  return job.jobStatus === "cancelled" && job.capturedCents != null && job.capturedCents > 0 && job.tripFeeCents != null && job.capturedCents <= job.tripFeeCents;
}

export function areaParts(area: string | null): { city: string | null; zip: string | null } {
  const text = area?.trim() ?? "";
  if (!text) return { city: null, zip: null };
  const zip = text.match(/\b(\d{5})\b/)?.[1] ?? null;
  const city = text.replace(/,?\s*\d{5}\b/, "").replace(/,/g, "").trim() || null;
  return { city, zip };
}

export function parseFinanceFilters(params: URLSearchParams): FinanceFilters {
  const tab = financeTabs.includes(params.get("tab") as FinanceTab) ? (params.get("tab") as FinanceTab) : "overview";
  const range = dateRanges.includes(params.get("range") as FinanceFilters["range"])
    ? (params.get("range") as FinanceFilters["range"])
    : "month";
  const date = dateBases.includes(params.get("date") as FinanceFilters["date"])
    ? (params.get("date") as FinanceFilters["date"])
    : "requested";
  const page = Number(params.get("page") ?? "1");
  return {
    tab,
    range,
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    date,
    cities: params.getAll("city").filter(Boolean),
    zips: params.getAll("zip").filter(Boolean),
    service: params.get("service") ?? "",
    pricing: params.get("pricing") ?? "",
    amountMin: params.get("min") ?? "",
    amountMax: params.get("max") ?? "",
    q: (params.get("q") ?? "").trim(),
    paymentStatus: params.get("payment") ?? "",
    fee: params.get("fee") ?? "",
    hold: params.get("hold") ?? "",
    report: params.get("report") ?? "",
    customer: params.get("customer") ?? "",
    ledgerStatus: params.get("ledger") ?? "",
    transferStatus: params.get("transfer") ?? "",
    holdReason: params.get("reason") ?? "",
    overdue: params.get("overdue") ?? "",
    driver: params.get("driver") ?? "",
    payoutSetup: params.get("setup") ?? "",
    issue: params.get("issue") ?? "",
    group: params.get("group") ?? "day",
    compare: params.get("compare") === "1",
    sort: params.get("sort") ?? "newest",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    includeTest: params.get("includeTest") === "1",
  };
}

export function filtersToParams(filters: FinanceFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set("tab", filters.tab);
  params.set("range", filters.range);
  params.set("date", filters.date);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  for (const city of filters.cities) params.append("city", city);
  for (const zip of filters.zips) params.append("zip", zip);
  if (filters.service) params.set("service", filters.service);
  if (filters.pricing) params.set("pricing", filters.pricing);
  if (filters.amountMin) params.set("min", filters.amountMin);
  if (filters.amountMax) params.set("max", filters.amountMax);
  if (filters.q) params.set("q", filters.q);
  if (filters.paymentStatus) params.set("payment", filters.paymentStatus);
  if (filters.fee) params.set("fee", filters.fee);
  if (filters.hold) params.set("hold", filters.hold);
  if (filters.report) params.set("report", filters.report);
  if (filters.customer) params.set("customer", filters.customer);
  if (filters.ledgerStatus) params.set("ledger", filters.ledgerStatus);
  if (filters.transferStatus) params.set("transfer", filters.transferStatus);
  if (filters.holdReason) params.set("reason", filters.holdReason);
  if (filters.overdue) params.set("overdue", filters.overdue);
  if (filters.driver) params.set("driver", filters.driver);
  if (filters.payoutSetup) params.set("setup", filters.payoutSetup);
  if (filters.issue) params.set("issue", filters.issue);
  if (filters.group !== "day") params.set("group", filters.group);
  if (filters.compare) params.set("compare", "1");
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  if (filters.page > 1) params.set("page", String(filters.page));
  if (filters.includeTest) params.set("includeTest", "1");
  return params;
}

function zonedParts(date: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: weekdays.indexOf(get("weekday")),
  };
}

export function midnightInNewYork(year: number, month: number, day: number): Date {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  let guess = Date.UTC(year, month - 1, day, 5, 0, 0);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatted.formatToParts(new Date(guess));
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
    const seen = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), 0);
    const wanted = Date.UTC(year, month - 1, day, 0, 0, 0);
    if (seen === wanted) return new Date(guess);
    guess += wanted - seen;
  }
  return new Date(guess);
}

function ymd(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addDays(parts: { year: number; month: number; day: number }, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function dateWindow(filters: FinanceFilters, now = new Date()): { start: Date; end: Date } | null {
  const today = zonedParts(now);
  if (filters.range === "custom") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters.from) || !/^\d{4}-\d{2}-\d{2}$/.test(filters.to)) return null;
    const [fy, fm, fd] = filters.from.split("-").map(Number);
    const [ty, tm, td] = filters.to.split("-").map(Number);
    const endParts = addDays({ year: ty, month: tm, day: td }, 1);
    return {
      start: midnightInNewYork(fy, fm, fd),
      end: midnightInNewYork(endParts.year, endParts.month, endParts.day),
    };
  }
  const startOfToday = midnightInNewYork(today.year, today.month, today.day);
  if (filters.range === "today") return { start: startOfToday, end: now };
  if (filters.range === "yesterday") {
    const y = addDays(today, -1);
    return { start: midnightInNewYork(y.year, y.month, y.day), end: startOfToday };
  }
  const mondayOffset = today.weekday === 0 ? -6 : 1 - today.weekday;
  const thisMonday = addDays(today, mondayOffset);
  if (filters.range === "week") return { start: midnightInNewYork(thisMonday.year, thisMonday.month, thisMonday.day), end: now };
  if (filters.range === "last_week") {
    const previous = addDays(thisMonday, -7);
    return {
      start: midnightInNewYork(previous.year, previous.month, previous.day),
      end: midnightInNewYork(thisMonday.year, thisMonday.month, thisMonday.day),
    };
  }
  if (filters.range === "month") return { start: midnightInNewYork(today.year, today.month, 1), end: now };
  const lastMonth = today.month === 1 ? { year: today.year - 1, month: 12, day: 1 } : { year: today.year, month: today.month - 1, day: 1 };
  return { start: midnightInNewYork(lastMonth.year, lastMonth.month, 1), end: midnightInNewYork(today.year, today.month, 1) };
}

export function previousWindow(window: { start: Date; end: Date }): { start: Date; end: Date } {
  const length = window.end.getTime() - window.start.getTime();
  return { start: new Date(window.start.getTime() - length), end: new Date(window.start.getTime()) };
}

function basisTime(job: FinanceJob, basis: FinanceFilters["date"]): string | null {
  if (basis === "requested") return job.createdAt;
  if (basis === "booked") return job.bookedAt;
  if (basis === "captured") return job.capturedAt;
  if (basis === "refunded") return job.refundedAt;
  return job.paidOutAt;
}

function inWindow(job: FinanceJob, filters: FinanceFilters, window: { start: Date; end: Date } | null): boolean {
  if (!window) return false;
  const stamp = basisTime(job, filters.date);
  if (!stamp) return false;
  const time = new Date(stamp).getTime();
  return time >= window.start.getTime() && time < window.end.getTime();
}

function amountFor(job: FinanceJob, tab: FinanceTab): number | null {
  if (tab === "payouts") return job.ledgerAmountCents;
  return job.priceCents;
}

function holdWindow(job: FinanceJob, hold: string, now: Date): boolean {
  if (!job.captureBefore || job.paymentStatus !== "authorized") return false;
  const hours = hold === "24h" ? 24 : hold === "3d" ? 72 : hold === "7d" ? 168 : 0;
  if (!hours) return true;
  const delta = new Date(job.captureBefore).getTime() - now.getTime();
  return delta >= 0 && delta <= hours * 60 * 60 * 1000;
}

export function holdClass(job: FinanceJob): "dispute" | "report" | "setup" | "admin" | null {
  if (job.openDispute || /dispute/i.test(job.holdReason ?? "")) return "dispute";
  if (job.openReport || /report/i.test(job.holdReason ?? "")) return "report";
  if (job.ledgerStatus === "held_until_onboarding" || /payout setup/i.test(job.holdReason ?? "")) return "setup";
  if (job.holdReason) return "admin";
  return null;
}

export function payoutDue(job: FinanceJob): string | null {
  return job.ledgerAvailableOn;
}

export function autoCompleteSoon(job: FinanceJob, now: Date): boolean {
  if (job.jobStatus !== "delivered" || job.paymentStatus !== "authorized" || job.customerConfirmedAt) return false;
  const due = new Date(job.jobUpdatedAt).getTime() + 24 * 60 * 60 * 1000;
  return due <= now.getTime() + 24 * 60 * 60 * 1000;
}

export function isOverdue(job: FinanceJob, now: Date): boolean {
  if (!job.ledgerStatus || ["transferred", "externally_paid", "recovered"].includes(job.ledgerStatus)) return false;
  const due = payoutDue(job);
  if (!due) return false;
  return new Date(due).getTime() < now.getTime() - 24 * 60 * 60 * 1000;
}

export function attentionIssues(job: FinanceJob, now: Date): string[] {
  const issues: string[] = [];
  if (job.paymentStatus === "authorized" && job.captureBefore) {
    const delta = new Date(job.captureBefore).getTime() - now.getTime();
    if (delta >= 0 && delta <= 24 * 60 * 60 * 1000) issues.push("hold_expiring");
  }
  if (job.paymentStatus === "awaiting_payment" && job.paymentDueAt && new Date(job.paymentDueAt).getTime() < now.getTime()) {
    issues.push("payment_overdue");
  }
  if (job.transferStatus === "failed") issues.push("failed_transfer");
  if (
    (job.ledgerStatus === "held" || job.ledgerStatus === "held_until_onboarding") &&
    job.ledgerAvailableOn &&
    new Date(job.ledgerAvailableOn).getTime() < now.getTime() - 7 * 24 * 60 * 60 * 1000
  ) {
    issues.push("long_held");
  }
  if (job.ledgerStatus === "recovery_due") issues.push("recovery_due");
  if (job.openDispute) issues.push("dispute");
  return issues;
}

function matchesSearch(job: FinanceJob, q: string): boolean {
  if (!q) return true;
  const hay = [job.id, job.customerFirst, job.driverFirst, job.paymentIntentId, job.transferId, job.caseNumber]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

export function filterJobs(jobs: FinanceJob[], filters: FinanceFilters, now = new Date(), window = dateWindow(filters, now)): FinanceJob[] {
  const min = filters.amountMin ? parseDollarsToCents(filters.amountMin) : null;
  const max = filters.amountMax ? parseDollarsToCents(filters.amountMax) : null;
  return jobs.filter((job) => {
    if (!inWindow(job, filters, window)) return false;
    if (filters.cities.length && !filters.cities.includes(job.pickupCity ?? "")) return false;
    if (filters.zips.length && !filters.zips.includes(job.pickupZip ?? "")) return false;
    if (filters.service && job.service !== filters.service) return false;
    if (filters.pricing === "admin_quote") return false;
    if (filters.pricing && filters.pricing !== "admin_quote" && job.pricingMethod !== filters.pricing) return false;
    const amount = amountFor(job, filters.tab);
    if ((min != null || max != null) && amount == null) return false;
    if (min != null && (amount ?? 0) < min) return false;
    if (max != null && (amount ?? 0) > max) return false;
    if (!matchesSearch(job, filters.q)) return false;
    const chip = paymentChip(job);
    if (filters.paymentStatus === "refunded_full" && refundKind(job) !== "full") return false;
    if (filters.paymentStatus === "refunded_partial" && refundKind(job) !== "partial") return false;
    if (filters.paymentStatus && !filters.paymentStatus.startsWith("refunded_") && chip !== filters.paymentStatus) return false;
    if (filters.fee === "late_cancel" && !isLateCancel(job)) return false;
    if (filters.fee === "trip" && !isTripFee(job)) return false;
    if (filters.fee === "normal" && (isTripFee(job) || isLateCancel(job))) return false;
    if (filters.hold && !holdWindow(job, filters.hold, now)) return false;
    if (filters.report === "yes" && !(job.openReport || job.openDispute)) return false;
    if (filters.report === "no" && (job.openReport || job.openDispute)) return false;
    if (filters.customer && job.customerId !== filters.customer) return false;
    if (filters.ledgerStatus && job.ledgerStatus !== filters.ledgerStatus) return false;
    if (filters.transferStatus && job.transferStatus !== filters.transferStatus) return false;
    if (filters.holdReason && holdClass(job) !== filters.holdReason) return false;
    if (filters.overdue === "yes" && !isOverdue(job, now)) return false;
    if (filters.overdue === "no" && isOverdue(job, now)) return false;
    if (filters.driver && job.driverId !== filters.driver) return false;
    if (filters.payoutSetup === "done" && job.payoutsEnabled !== true) return false;
    if (filters.payoutSetup === "missing" && job.payoutsEnabled !== false) return false;
    if (filters.issue && !attentionIssues(job, now).includes(filters.issue)) return false;
    if (filters.tab === "payouts" && !job.ledgerStatus) return false;
    if (filters.tab === "attention" && attentionIssues(job, now).length === 0) return false;
    return true;
  });
}

function timeValue(job: FinanceJob, filters: FinanceFilters): number {
  const stamp = basisTime(job, filters.date) ?? job.createdAt;
  return new Date(stamp).getTime();
}

export function sortJobs(jobs: FinanceJob[], filters: FinanceFilters): FinanceJob[] {
  const copy = [...jobs];
  copy.sort((left, right) => {
    if (filters.sort === "oldest") return timeValue(left, filters) - timeValue(right, filters);
    if (filters.sort === "amount_desc" || filters.sort === "amount_asc") {
      const a = amountFor(left, filters.tab);
      const b = amountFor(right, filters.tab);
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return filters.sort === "amount_desc" ? b - a : a - b;
    }
    if (filters.sort === "due") {
      const a = left.captureBefore ?? left.paymentDueAt ?? left.ledgerAvailableOn;
      const b = right.captureBefore ?? right.paymentDueAt ?? right.ledgerAvailableOn;
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return new Date(a).getTime() - new Date(b).getTime();
    }
    return timeValue(right, filters) - timeValue(left, filters);
  });
  return copy;
}

export function pageRows<T>(rows: T[], page: number, size = 25): T[] {
  const start = (page - 1) * size;
  return rows.slice(start, start + size);
}

export function countMoney(jobs: FinanceJob[], pick: (job: FinanceJob) => number | null): { count: number; amount: Money } {
  const amounts = jobs.map((job) => knownCents(pick(job)));
  return { count: jobs.length, amount: jobs.length === 0 ? { cents: 0 } : addMoney(amounts) };
}

export function paymentBuckets(jobs: FinanceJob[]) {
  const of = (chip: (typeof paymentChips)[number]) => jobs.filter((job) => paymentChip(job) === chip);
  return {
    held: countMoney(of("held"), (job) => job.priceCents),
    charged: countMoney(of("charged").concat(of("partially_charged")), (job) => job.capturedCents),
    released: countMoney(of("released"), (job) => job.priceCents),
    refunded: countMoney(of("refunded"), (job) => (job.refundedCents && job.refundedCents > 0 ? job.refundedCents : null)),
    disputed: countMoney(of("disputed"), (job) => job.priceCents),
  };
}

export function payoutBuckets(jobs: FinanceJob[]) {
  const of = (status: (typeof ledgerStatuses)[number]) => jobs.filter((job) => job.ledgerStatus === status);
  return Object.fromEntries(ledgerStatuses.map((status) => [status, countMoney(of(status), (job) => job.ledgerAmountCents)])) as Record<
    (typeof ledgerStatuses)[number],
    { count: number; amount: Money }
  >;
}

export function pricingBalances(job: FinanceJob): boolean {
  if (
    job.priceCents == null ||
    job.driverPayCents == null ||
    job.platformFeeCents == null ||
    job.serviceFeeCents == null
  ) {
    return false;
  }
  const parts = job.driverPayCents + job.platformFeeCents + job.serviceFeeCents === job.priceCents;
  const ledger =
    job.ledgerAmountCents == null ||
    job.jobStatus !== "completed" ||
    job.ledgerAmountCents === job.driverPayCents;
  return parts && ledger;
}

/** Commission stays inside the offer. The service fee is additional marketplace revenue. Stripe's fee is an expense. */
export function revenue(jobs: FinanceJob[]): {
  platform: Money;
  service: Money;
  stripe: Money;
  trip: Money;
  lateCancel: Money;
  refunds: Money;
  net: Money;
} {
  const captured = jobs.filter((job) => job.capturedCents != null && job.capturedCents > 0);
  const platform = countMoney(captured, (job) => job.platformFeeCents).amount;
  const service = countMoney(
    captured.filter((job) => !isTripFee(job) && !isLateCancel(job)),
    (job) => job.serviceFeeCents,
  ).amount;
  const stripe = countMoney(captured, (job) => job.stripeFeeCents).amount;
  const tripJobs = captured.filter(isTripFee);
  const trip = countMoney(tripJobs, (job) => job.capturedCents).amount;
  const lateCancel = countMoney(captured.filter(isLateCancel), (job) => job.lateCancelCents).amount;
  const refunds = countMoney(
    jobs.filter((job) => (job.refundedCents ?? 0) > 0),
    (job) => job.refundedCents,
  ).amount;
  const net = addMoney([
    platform,
    service,
    "cents" in stripe ? { cents: -stripe.cents } : stripe,
    "cents" in refunds ? { cents: -refunds.cents } : refunds,
  ]);
  return { platform, service, stripe, trip, lateCancel, refunds, net };
}

export function changePercent(current: Money, previous: Money): string {
  if (!("cents" in current) || !("cents" in previous) || previous.cents === 0) return "Not comparable";
  const pct = Math.round(((current.cents - previous.cents) / previous.cents) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

export function dailyChart(jobs: FinanceJob[]): { day: string; captured: Money; refunded: Money }[] {
  const days = new Map<string, FinanceJob[]>();
  for (const job of jobs) {
    const stamp = job.capturedAt ?? job.refundedAt;
    if (!stamp) continue;
    const day = ymd(zonedParts(new Date(stamp)));
    days.set(day, [...(days.get(day) ?? []), job]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, rows]) => ({
      day,
      captured: countMoney(rows.filter((job) => job.capturedAt && ymd(zonedParts(new Date(job.capturedAt))) === day), (job) => job.capturedCents).amount,
      refunded: countMoney(rows.filter((job) => (job.refundedCents ?? 0) > 0), (job) => job.refundedCents).amount,
    }));
}

export function toCsv(jobs: FinanceJob[]): string {
  const headers = [
    "Date",
    "Job",
    "Customer",
    "Driver",
    "Service",
    "Status",
    "Total",
    "Captured",
    "Refunded",
    "Ledger status",
    "Transfer status",
    "Bank payout",
    "PaymentIntent",
    "Transfer",
  ];
  const lines = jobs.map((job) =>
    [
      job.createdAt,
      job.id,
      job.customerFirst ?? "",
      job.driverFirst ?? "",
      serviceName(job.service),
      paymentChip(job) ? chipLabel[paymentChip(job)!] : "",
      job.priceCents == null ? "Unavailable" : formatCents(job.priceCents),
      job.capturedCents == null ? "Unavailable" : formatCents(job.capturedCents),
      job.refundedCents == null ? "Unavailable" : formatCents(job.refundedCents),
      job.ledgerStatus ? ledgerLabel[job.ledgerStatus] : "",
      job.transferStatus ?? "",
      "Not tracked",
      job.paymentIntentId ?? "",
      job.transferId ?? "",
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(","),
  );
  return [headers.join(","), ...lines].join("\n");
}

export function listTotal(jobs: FinanceJob[], tab: FinanceTab): string {
  if (tab === "payouts") {
    const amount = countMoney(jobs, (job) => job.ledgerAmountCents).amount;
    return `${jobs.length} payouts · ${showMoney(amount)}`;
  }
  const charged = jobs.filter((job) => paymentChip(job) === "charged" || paymentChip(job) === "partially_charged");
  const amount = countMoney(charged, (job) => job.capturedCents).amount;
  return `${jobs.length} payments · ${showMoney(amount)} charged`;
}

export function quickView(name: "attention" | "payouts" | "refunds" | "holds"): URLSearchParams {
  if (name === "attention") return new URLSearchParams({ tab: "attention", range: "today", date: "requested" });
  if (name === "payouts") return new URLSearchParams({ tab: "payouts", range: "week", date: "paid_out" });
  if (name === "refunds") return new URLSearchParams({ tab: "payments", range: "month", date: "refunded", payment: "refunded" });
  return new URLSearchParams({ tab: "payments", range: "month", date: "requested", payment: "held", hold: "7d" });
}

export function groupRows(jobs: FinanceJob[], group: string): { key: string; count: number; amount: Money }[] {
  const groups = new Map<string, FinanceJob[]>();
  for (const job of jobs) {
    const stamp = job.capturedAt ?? job.createdAt;
    const parts = zonedParts(new Date(stamp));
    const mondayOffset = parts.weekday === 0 ? -6 : 1 - parts.weekday;
    const key =
      group === "city"
        ? job.pickupCity ?? "Unknown city"
        : group === "service"
          ? serviceName(job.service)
          : group === "driver"
            ? job.driverFirst ?? "Unassigned"
            : group === "month"
              ? ymd(parts).slice(0, 7)
              : group === "week"
                ? ymd(addDays(parts, mondayOffset))
                : ymd(parts);
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return [...groups.entries()].map(([key, rows]) => ({
    key,
    count: rows.length,
    amount: countMoney(rows, (job) => job.capturedCents).amount,
  }));
}
