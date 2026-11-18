import { midnightInNewYork } from "@/lib/admin/finance";
import {
  classifySource,
  sourceLabel,
  type AttributionSource,
} from "@/lib/analytics/attribution";

export const leadTimeZone = "America/New_York";
/** A visit step is abandoned only after this much quiet time. */
export const visitInactivityMs = 30 * 60 * 1000;

export const rangePresets = ["today", "yesterday", "7d", "30d", "month", "last_month", "custom"] as const;
export type RangePreset = (typeof rangePresets)[number];
export const trendGroups = ["hour", "day", "week", "month"] as const;
export type TrendGroup = (typeof trendGroups)[number];
export type TouchChoice = "first" | "last";

export const visitStages = [
  "landing_viewed",
  "request_viewed",
  "request_started",
  "service_selected",
  "what_completed",
  "where_completed",
  "price_reached",
  "verify_reached",
  "request_submitted",
] as const;
export type VisitStage = (typeof visitStages)[number];

export const jobStages = [
  "request_saved",
  "checkout_started",
  "payment_authorized",
  "payment_captured",
  "delivery_completed",
] as const;
export type JobStage = (typeof jobStages)[number];

const visitLabels: Record<VisitStage, string> = {
  landing_viewed: "Landing page viewed",
  request_viewed: "Request page viewed",
  request_started: "Request started",
  service_selected: "Service selected",
  what_completed: "What step completed",
  where_completed: "Where step completed",
  price_reached: "Price step reached",
  verify_reached: "Verification step reached",
  request_submitted: "Request submitted",
};

const jobLabels: Record<JobStage, string> = {
  request_saved: "Request saved",
  checkout_started: "Checkout started",
  payment_authorized: "Payment authorized",
  payment_captured: "Payment captured",
  delivery_completed: "Delivery completed",
};

export function visitStageLabel(stage: VisitStage): string {
  return visitLabels[stage];
}

export function jobStageLabel(stage: JobStage): string {
  return jobLabels[stage];
}

export type LeadEvent = {
  sessionId: string;
  stage: VisitStage;
  service: string | null;
  at: string;
};

export type LeadVisit = {
  sessionId: string;
  firstUtmSource: string | null;
  lastUtmSource: string | null;
  firstReferrerHost: string | null;
  lastReferrerHost: string | null;
  firstCampaign: string | null;
  lastCampaign: string | null;
  firstAdset: string | null;
  lastAdset: string | null;
  firstAd: string | null;
  lastAd: string | null;
  landingPath: string | null;
};

export type LeadJob = {
  id: string;
  service: string;
  status: string;
  createdAt: string;
  paymentStatus: string | null;
  capturedCents: number | null;
  refundedCents: number | null;
  paymentDueAt: string | null;
  checkoutAt: string | null;
  authorizedAt: string | null;
  capturedAt: string | null;
  deliveredAt: string | null;
  transferAt: string | null;
  transferred: boolean;
  firstUtmSource: string | null;
  lastUtmSource: string | null;
  firstReferrerHost: string | null;
  lastReferrerHost: string | null;
  firstCampaign: string | null;
  lastCampaign: string | null;
  firstAdset: string | null;
  lastAdset: string | null;
  firstAd: string | null;
  lastAd: string | null;
};

export type FunnelRow = {
  key: string;
  label: string;
  unit: "sessions" | "requests";
  reached: number;
  continued: number;
  abandoned: number;
  inProgress: number;
  stepRate: number | null;
  overallRate: number | null;
};

export type SourceRow = {
  source: AttributionSource;
  label: string;
  campaign: string;
  adset: string;
  ad: string;
  visitors: number;
  starts: number;
  submitted: number;
  authorized: number;
  captured: number;
  revenueCents: number;
  conversionRate: number | null;
  averageOrderCents: number | null;
};

export type TrendPoint = {
  bucket: string;
  visitors: number;
  starts: number;
  submitted: number;
  checkouts: number;
  authorized: number;
  captured: number;
  revenueCents: number;
};

export type LeadReport = {
  visitors: number;
  sessions: number;
  starts: number;
  submitted: number;
  checkouts: number;
  authorized: number;
  captured: number;
  deliveries: number;
  transfers: number;
  revenueCents: number;
  refundedCents: number;
  netRevenueCents: number;
  averageOrderCents: number | null;
  visitorToLead: number | null;
  leadToCheckout: number | null;
  checkoutToPayment: number | null;
  visitorToPaying: number | null;
  visitFunnel: FunnelRow[];
  jobFunnel: FunnelRow[];
  biggestDropOff: string | null;
  serviceFunnels: { service: string; rows: FunnelRow[]; biggestDropOff: string | null }[];
  sources: SourceRow[];
  campaigns: SourceRow[];
  trends: TrendPoint[];
  activity: ActivityRow[];
};

export type ActivityRow = {
  id: string;
  service: string;
  status: string;
  createdAt: string;
  checkout: boolean;
  authorized: boolean;
  captured: boolean;
  delivered: boolean;
  transferred: boolean;
  refund: "none" | "partial" | "full";
  firstSource: AttributionSource;
  lastSource: AttributionSource;
  firstCampaign: string | null;
  lastCampaign: string | null;
};

function parts(date: Date): { year: number; month: number; day: number; hour: number; weekday: number } {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: leadTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) => formatted.find((part) => part.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: Number(read("hour")),
    weekday: weekdays.indexOf(read("weekday")),
  };
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function easternDay(date: Date): string {
  const piece = parts(date);
  return ymd(piece.year, piece.month, piece.day);
}

export const visitRangePresets = ["today", "yesterday", "7d", "30d", "custom"] as const;
export type VisitRangePreset = (typeof visitRangePresets)[number];

function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const date = midnightInNewYork(year, month, day);
  date.setUTCDate(date.getUTCDate() + days);
  const next = parts(date);
  return { year: next.year, month: next.month, day: next.day };
}

export function leadRange(
  preset: RangePreset,
  from: string,
  to: string,
  now: Date,
): { start: Date; end: Date } {
  const today = parts(now);
  const startToday = midnightInNewYork(today.year, today.month, today.day);
  const tomorrow = addDays(today.year, today.month, today.day, 1);
  const endTomorrow = midnightInNewYork(tomorrow.year, tomorrow.month, tomorrow.day);
  if (preset === "today") return { start: startToday, end: endTomorrow };
  if (preset === "yesterday") {
    const previous = addDays(today.year, today.month, today.day, -1);
    return { start: midnightInNewYork(previous.year, previous.month, previous.day), end: startToday };
  }
  if (preset === "7d" || preset === "30d") {
    const previous = addDays(today.year, today.month, today.day, preset === "7d" ? -6 : -29);
    return { start: midnightInNewYork(previous.year, previous.month, previous.day), end: endTomorrow };
  }
  if (preset === "month") return { start: midnightInNewYork(today.year, today.month, 1), end: endTomorrow };
  if (preset === "last_month") {
    const month = today.month === 1 ? 12 : today.month - 1;
    const year = today.month === 1 ? today.year - 1 : today.year;
    return { start: midnightInNewYork(year, month, 1), end: midnightInNewYork(today.year, today.month, 1) };
  }
  const start = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : ymd(today.year, today.month, today.day);
  const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : start;
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const first = midnightInNewYork(sy, sm, sd);
  const last = midnightInNewYork(ey, em, ed);
  if (last.getTime() < first.getTime()) {
    const next = addDays(sy, sm, sd, 1);
    return { start: first, end: midnightInNewYork(next.year, next.month, next.day) };
  }
  const next = addDays(ey, em, ed, 1);
  return { start: first, end: midnightInNewYork(next.year, next.month, next.day) };
}

export function inRange(value: string | null, start: Date, end: Date): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
}

export function trendBucket(value: string, group: TrendGroup): string {
  const date = new Date(value);
  const piece = parts(date);
  if (group === "hour") return `${ymd(piece.year, piece.month, piece.day)} ${String(piece.hour).padStart(2, "0")}:00`;
  if (group === "month") return `${piece.year}-${String(piece.month).padStart(2, "0")}`;
  if (group === "week") {
    const mondayOffset = piece.weekday === 0 ? -6 : 1 - piece.weekday;
    const monday = addDays(piece.year, piece.month, piece.day, mondayOffset);
    return `Week of ${ymd(monday.year, monday.month, monday.day)}`;
  }
  return ymd(piece.year, piece.month, piece.day);
}

function rate(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return part / whole;
}

function stageIndex(stage: VisitStage): number {
  return visitStages.indexOf(stage);
}

type SessionProgress = {
  sessionId: string;
  highest: number;
  lastAt: number;
  service: string | null;
  serviceAt: number;
  sawLanding: boolean;
  sawStart: boolean;
  seen: Set<VisitStage>;
  stageAt: Partial<Record<VisitStage, string>>;
};

function sessionsFrom(events: LeadEvent[], start: Date, end: Date): SessionProgress[] {
  const grouped = new Map<string, SessionProgress>();
  for (const event of events) {
    if (!inRange(event.at, start, end)) continue;
    const index = stageIndex(event.stage);
    if (index < 0) continue;
    const time = Date.parse(event.at);
    const current = grouped.get(event.sessionId) ?? {
      sessionId: event.sessionId,
      highest: -1,
      lastAt: 0,
      service: null,
      serviceAt: -1,
      sawLanding: false,
      sawStart: false,
      seen: new Set<VisitStage>(),
      stageAt: {},
    };
    current.seen.add(event.stage);
    const recordedAt = current.stageAt[event.stage];
    if (!recordedAt || event.at < recordedAt) current.stageAt[event.stage] = event.at;
    if (index > current.highest) current.highest = index;
    if (time > current.lastAt) current.lastAt = time;
    if (event.stage === "landing_viewed") current.sawLanding = true;
    if (event.stage === "request_started") current.sawStart = true;
    if (event.service && time >= current.serviceAt) {
      current.service = event.service;
      current.serviceAt = time;
    }
    grouped.set(event.sessionId, current);
  }
  return [...grouped.values()];
}

function visitFunnel(rows: SessionProgress[], now: Date, startStage: VisitStage | "" = ""): FunnelRow[] {
  const population = startStage ? rows.filter((row) => row.seen.has(startStage)) : rows;
  const startIndex = startStage ? stageIndex(startStage) : 0;
  return visitStages.slice(startIndex).map((stage) => {
    const index = stageIndex(stage);
    const reachedRows = population.filter((row) => row.seen.has(stage));
    const later = visitStages.slice(index + 1);
    const continued = reachedRows.filter((row) => later.some((next) => row.seen.has(next)));
    const here = reachedRows.filter((row) => row.highest === index);
    const abandoned = here.filter((row) => now.getTime() - row.lastAt >= visitInactivityMs);
    const inProgress = here.filter((row) => now.getTime() - row.lastAt < visitInactivityMs);
    const nextStage = visitStages[index + 1];
    const next = nextStage ? reachedRows.filter((row) => row.seen.has(nextStage)).length : null;
    return {
      key: stage,
      label: visitLabels[stage],
      unit: "sessions" as const,
      reached: reachedRows.length,
      continued: continued.length,
      abandoned: abandoned.length,
      inProgress: inProgress.length,
      stepRate: next == null ? null : rate(next, reachedRows.length),
      overallRate: rate(reachedRows.length, population.length),
    };
  });
}

export type VisitFunnelFilters = {
  start: Date;
  end: Date;
  source: AttributionSource | "";
  campaign: string;
  service: string;
  stage: VisitStage | "";
  touch: TouchChoice;
  drill: VisitStage | "";
};

export type VisitBreakdown = { label: string; count: number };

export type VisitStageDrill = {
  stage: VisitStage;
  label: string;
  reached: number;
  continued: number;
  dropped: number;
  abandoned: number;
  sources: VisitBreakdown[];
  campaigns: VisitBreakdown[];
  services: VisitBreakdown[];
  times: VisitBreakdown[];
  sessions: string[];
  sessionCount: number;
};

export type VisitFunnelView = {
  rows: FunnelRow[];
  sessions: number;
  overallConversion: number | null;
  biggestDropOff: string | null;
  campaigns: string[];
  empty: boolean;
  drill: VisitStageDrill | null;
};

const unknownCampaign = "__unknown__";

function chosenTouch(visit: LeadVisit | undefined, choice: TouchChoice) {
  if (!visit) return { utmSource: null, referrerHost: null, campaign: null as string | null };
  const touch = touchOf(visit, choice);
  return {
    utmSource: touch.utmSource,
    referrerHost: touch.referrerHost,
    campaign: touch.campaign?.trim() ? touch.campaign.trim() : null,
  };
}

function visitSource(touch: { utmSource: string | null; referrerHost: string | null; campaign: string | null }): AttributionSource {
  if (!touch.utmSource && !touch.referrerHost && !touch.campaign) return "unknown";
  return classifySource(touch);
}

function countBy(labels: string[]): VisitBreakdown[] {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

/**
 * Visit-session funnel. A stage counts only when that step was stored.
 * Opening a later page does not create a landing session.
 * Saved jobs and payments are not an input.
 */
export function buildVisitFunnel(input: {
  events: LeadEvent[];
  visits: LeadVisit[];
  now: Date;
  filters: VisitFunnelFilters;
}): VisitFunnelView {
  const sessions = sessionsFrom(input.events, input.filters.start, input.filters.end);
  const visitsById = new Map(input.visits.map((visit) => [visit.sessionId, visit]));
  const described = sessions.map((session) => {
    const touch = chosenTouch(visitsById.get(session.sessionId), input.filters.touch);
    return { session, source: visitSource(touch), campaign: touch.campaign };
  });
  const campaigns = [...new Set(described.flatMap((row) => (row.campaign ? [row.campaign] : [])))].sort((left, right) =>
    left.localeCompare(right),
  );
  const filtered = described.filter((row) => {
    if (input.filters.source && row.source !== input.filters.source) return false;
    if (input.filters.campaign === unknownCampaign && row.campaign) return false;
    if (input.filters.campaign && input.filters.campaign !== unknownCampaign && row.campaign !== input.filters.campaign) return false;
    if (input.filters.service && row.session.service !== input.filters.service) return false;
    if (input.filters.stage && !row.session.seen.has(input.filters.stage)) return false;
    return true;
  });
  const rows = visitFunnel(filtered.map((row) => row.session), input.now, input.filters.stage);
  const population = filtered.length;
  const submitted = filtered.filter((row) => row.session.seen.has("request_submitted")).length;
  const drillStage = input.filters.drill && rows.some((row) => row.key === input.filters.drill) ? input.filters.drill : "";
  const drillRows = drillStage ? filtered.filter((row) => row.session.seen.has(drillStage)) : [];
  const drillIndex = drillStage ? stageIndex(drillStage) : -1;
  const drillContinued = drillRows.filter((row) => visitStages.slice(drillIndex + 1).some((next) => row.session.seen.has(next)));
  const drillHere = drillRows.filter((row) => row.session.highest === drillIndex);
  const serviceNames = new Map([
    ["delivery", "Pickup & Delivery"],
    ["free_item", "Free-Item Pickups"],
    ["junk", "Junk Removal & Hauling"],
    ["construction", "Construction Store Deliveries"],
  ]);
  const span = input.filters.end.getTime() - input.filters.start.getTime();
  const group: TrendGroup = span <= 2 * 24 * 60 * 60 * 1000 ? "hour" : "day";
  return {
    rows,
    sessions: population,
    overallConversion: rate(submitted, population),
    biggestDropOff: biggest(rows),
    campaigns: campaigns.slice(0, 100),
    empty: population === 0,
    drill: drillStage
      ? {
          stage: drillStage,
          label: visitLabels[drillStage],
          reached: drillRows.length,
          continued: drillContinued.length,
          dropped: drillRows.length - drillContinued.length,
          abandoned: drillHere.filter((row) => input.now.getTime() - row.session.lastAt >= visitInactivityMs).length,
          sources: countBy(drillRows.map((row) => sourceLabel(row.source))),
          campaigns: countBy(drillRows.map((row) => row.campaign ?? "Unknown")),
          services: countBy(drillRows.map((row) => (row.session.service ? serviceNames.get(row.session.service) ?? row.session.service : "Not selected"))),
          times: countBy(
            drillRows.flatMap((row) => {
              const at = row.session.stageAt[drillStage];
              return at ? [trendBucket(at, group)] : [];
            }),
          ),
          sessions: drillRows.map((row) => row.session.sessionId).slice(0, 20),
          sessionCount: drillRows.length,
        }
      : null,
  };
}

export const unknownVisitCampaign = unknownCampaign;

function biggest(rows: FunnelRow[]): string | null {
  const candidates = rows.filter((row) => row.abandoned > 0);
  if (!candidates.length) return null;
  candidates.sort((left, right) => right.abandoned - left.abandoned);
  return candidates[0]?.label ?? null;
}

function jobReached(job: LeadJob, stage: JobStage, start: Date, end: Date): boolean {
  if (stage === "request_saved") return inRange(job.createdAt, start, end);
  if (stage === "checkout_started") return inRange(job.checkoutAt, start, end);
  if (stage === "payment_authorized") return inRange(job.authorizedAt, start, end);
  if (stage === "payment_captured") return inRange(job.capturedAt, start, end) && (job.capturedCents ?? 0) > 0;
  return inRange(job.deliveredAt, start, end);
}

function cohortReached(job: LeadJob, stage: JobStage): boolean {
  if (stage === "request_saved") return true;
  if (stage === "checkout_started") return job.checkoutAt != null;
  if (stage === "payment_authorized") return job.authorizedAt != null;
  if (stage === "payment_captured") return (job.capturedCents ?? 0) > 0;
  return job.deliveredAt != null || job.status === "delivered" || job.status === "completed";
}

/**
 * Saved-request funnel for jobs created in the range.
 * Checkout is "stopped" only after the payment window has passed.
 * A request with no checkout is still open, not abandoned.
 */
function jobFunnel(jobs: LeadJob[], now: Date): FunnelRow[] {
  return jobStages.map((stage, index) => {
    const reached = jobs.filter((job) => cohortReached(job, stage));
    const nextStage = jobStages[index + 1];
    const continued = nextStage ? jobs.filter((job) => cohortReached(job, stage) && cohortReached(job, nextStage)) : [];
    let abandoned = 0;
    let inProgress = 0;
    if (stage === "checkout_started") {
      const stuck = jobs.filter((job) => job.checkoutAt != null && job.authorizedAt == null && (job.capturedCents ?? 0) <= 0);
      abandoned = stuck.filter((job) => {
        const due = job.paymentDueAt ? Date.parse(job.paymentDueAt) : Number.NaN;
        return Number.isFinite(due) && due <= now.getTime();
      }).length;
      inProgress = stuck.length - abandoned;
    } else if (nextStage) {
      inProgress = reached.length - continued.length;
    }
    const nextCount = nextStage ? jobs.filter((job) => cohortReached(job, nextStage)).length : null;
    return {
      key: stage,
      label: jobLabels[stage],
      unit: "requests",
      reached: reached.length,
      continued: continued.length,
      abandoned,
      inProgress,
      stepRate: nextCount == null ? null : rate(nextCount, reached.length),
      overallRate: rate(reached.length, jobs.length),
    };
  });
}

function touchOf(visit: LeadVisit, choice: TouchChoice): { utmSource: string | null; referrerHost: string | null; campaign: string | null; adset: string | null; ad: string | null } {
  if (choice === "first") {
    return {
      utmSource: visit.firstUtmSource,
      referrerHost: visit.firstReferrerHost,
      campaign: visit.firstCampaign,
      adset: visit.firstAdset,
      ad: visit.firstAd,
    };
  }
  return {
    utmSource: visit.lastUtmSource ?? visit.firstUtmSource,
    referrerHost: visit.lastReferrerHost ?? visit.firstReferrerHost,
    campaign: visit.lastCampaign ?? visit.firstCampaign,
    adset: visit.lastAdset ?? visit.firstAdset,
    ad: visit.lastAd ?? visit.firstAd,
  };
}

function jobTouch(job: LeadJob, choice: TouchChoice) {
  if (choice === "first") {
    return {
      utmSource: job.firstUtmSource,
      referrerHost: job.firstReferrerHost,
      campaign: job.firstCampaign,
      adset: job.firstAdset,
      ad: job.firstAd,
    };
  }
  return {
    utmSource: job.lastUtmSource ?? job.firstUtmSource,
    referrerHost: job.lastReferrerHost ?? job.firstReferrerHost,
    campaign: job.lastCampaign ?? job.firstCampaign,
    adset: job.lastAdset ?? job.firstAdset,
    ad: job.lastAd ?? job.firstAd,
  };
}

function hasAttribution(job: LeadJob): boolean {
  return Boolean(
    job.firstUtmSource ||
      job.lastUtmSource ||
      job.firstReferrerHost ||
      job.lastReferrerHost ||
      job.firstCampaign ||
      job.lastCampaign,
  );
}

export function jobSource(job: LeadJob, choice: TouchChoice): AttributionSource {
  if (!hasAttribution(job)) return "unknown";
  return classifySource(jobTouch(job, choice));
}

function refundOf(job: LeadJob): "none" | "partial" | "full" {
  const refunded = job.refundedCents ?? 0;
  if (refunded <= 0 && job.paymentStatus !== "refunded") return "none";
  if (job.capturedCents != null && refunded >= job.capturedCents && job.capturedCents > 0) return "full";
  if (refunded > 0) return "partial";
  if (job.paymentStatus === "refunded") return "full";
  return "none";
}

function addTrend(map: Map<string, TrendPoint>, bucket: string, key: keyof TrendPoint, amount = 1) {
  const current = map.get(bucket) ?? {
    bucket,
    visitors: 0,
    starts: 0,
    submitted: 0,
    checkouts: 0,
    authorized: 0,
    captured: 0,
    revenueCents: 0,
  };
  if (key !== "bucket") current[key] += amount;
  map.set(bucket, current);
}

export function buildLeadReport(input: {
  events: LeadEvent[];
  visits: LeadVisit[];
  jobs: LeadJob[];
  start: Date;
  end: Date;
  now: Date;
  group: TrendGroup;
  touch: TouchChoice;
  service: string;
  status: string;
  source: string;
}): LeadReport {
  const events = input.service
    ? input.events.filter((event) => event.service == null || event.service === input.service)
    : input.events;
  const sessions = sessionsFrom(events, input.start, input.end);
  const visitsById = new Map(input.visits.map((visit) => [visit.sessionId, visit]));
  const sessionSource = (sessionId: string): AttributionSource => {
    const visit = visitsById.get(sessionId);
    return visit ? classifySource(touchOf(visit, input.touch)) : "unknown";
  };
  const serviceSessions = sessions.filter((row) => {
    if (input.service && row.service !== input.service) return false;
    if (input.source && sessionSource(row.sessionId) !== input.source) return false;
    return true;
  });
  const visitRows = visitFunnel(serviceSessions, input.now);
  const cohort = input.jobs.filter((job) => inRange(job.createdAt, input.start, input.end));
  const matchesJob = (job: LeadJob) =>
    (!input.service || job.service === input.service) && (!input.source || jobSource(job, input.touch) === input.source);
  const cohortJobs = cohort.filter(matchesJob);
  const requestRows = jobFunnel(cohortJobs, input.now);
  const landing = serviceSessions.filter((row) => row.sawLanding).length;
  const starts = serviceSessions.filter((row) => row.sawStart).length;
  const checkouts = input.jobs.filter((job) => matchesJob(job) && jobReached(job, "checkout_started", input.start, input.end));
  const authorized = input.jobs.filter((job) => matchesJob(job) && jobReached(job, "payment_authorized", input.start, input.end));
  const captured = input.jobs.filter((job) => matchesJob(job) && jobReached(job, "payment_captured", input.start, input.end));
  const deliveries = input.jobs.filter((job) => matchesJob(job) && jobReached(job, "delivery_completed", input.start, input.end));
  const transfers = input.jobs.filter((job) => matchesJob(job) && job.transferred && inRange(job.transferAt, input.start, input.end));
  const revenueCents = captured.reduce((sum, job) => sum + (job.capturedCents ?? 0), 0);
  const refundedCents = captured.reduce((sum, job) => sum + Math.max(0, job.refundedCents ?? 0), 0);
  const netRevenueCents = revenueCents - refundedCents;
  const visitsBySession = visitsById;
  const sourceMap = new Map<string, SourceRow>();
  function sourceRow(source: AttributionSource, campaign: string, adset: string, ad: string): SourceRow {
    const key = `${source}|${campaign}|${adset}|${ad}`;
    const existing = sourceMap.get(key);
    if (existing) return existing;
    const created: SourceRow = {
      source,
      label: sourceLabel(source),
      campaign,
      adset,
      ad,
      visitors: 0,
      starts: 0,
      submitted: 0,
      authorized: 0,
      captured: 0,
      revenueCents: 0,
      conversionRate: null,
      averageOrderCents: null,
    };
    sourceMap.set(key, created);
    return created;
  }

  for (const session of serviceSessions) {
    const visit = visitsBySession.get(session.sessionId);
    const chosen = visit ? touchOf(visit, input.touch) : { utmSource: null, referrerHost: null, campaign: null, adset: null, ad: null };
    const source = visit ? classifySource(chosen) : "unknown";
    const row = sourceRow(source, "All campaigns", "", "");
    if (session.sawLanding) row.visitors += 1;
    if (session.sawStart) row.starts += 1;
    if (chosen.campaign || chosen.adset || chosen.ad) {
      const detail = sourceRow(source, chosen.campaign ?? "Unknown", chosen.adset ?? "Unknown", chosen.ad ?? "Unknown");
      if (session.sawLanding) detail.visitors += 1;
      if (session.sawStart) detail.starts += 1;
    }
  }

  for (const job of cohortJobs) {
    const source = jobSource(job, input.touch);
    const chosen = jobTouch(job, input.touch);
    sourceRow(source, "All campaigns", "", "").submitted += 1;
    if (chosen.campaign || chosen.adset || chosen.ad) {
      sourceRow(source, chosen.campaign ?? "Unknown", chosen.adset ?? "Unknown", chosen.ad ?? "Unknown").submitted += 1;
    }
  }
  for (const job of authorized) {
    const source = jobSource(job, input.touch);
    const chosen = jobTouch(job, input.touch);
    sourceRow(source, "All campaigns", "", "").authorized += 1;
    if (chosen.campaign || chosen.adset || chosen.ad) {
      sourceRow(source, chosen.campaign ?? "Unknown", chosen.adset ?? "Unknown", chosen.ad ?? "Unknown").authorized += 1;
    }
  }
  for (const job of captured) {
    const source = jobSource(job, input.touch);
    const chosen = jobTouch(job, input.touch);
    const cents = job.capturedCents ?? 0;
    const rollup = sourceRow(source, "All campaigns", "", "");
    rollup.captured += 1;
    rollup.revenueCents += cents;
    if (chosen.campaign || chosen.adset || chosen.ad) {
      const detail = sourceRow(source, chosen.campaign ?? "Unknown", chosen.adset ?? "Unknown", chosen.ad ?? "Unknown");
      detail.captured += 1;
      detail.revenueCents += cents;
    }
  }
  const sources = [...sourceMap.values()].map((row) => ({
    ...row,
    conversionRate: rate(row.captured, row.visitors),
    averageOrderCents: row.captured > 0 ? Math.round(row.revenueCents / row.captured) : null,
  }));
  sources.sort((left, right) => right.revenueCents - left.revenueCents || right.submitted - left.submitted || left.label.localeCompare(right.label));

  const trends = new Map<string, TrendPoint>();
  for (const session of serviceSessions) {
    const event = events
      .filter((item) => item.sessionId === session.sessionId && inRange(item.at, input.start, input.end))
      .sort((left, right) => left.at.localeCompare(right.at))[0];
    if (!event) continue;
    addTrend(trends, trendBucket(event.at, input.group), "visitors");
    if (session.sawStart) addTrend(trends, trendBucket(event.at, input.group), "starts");
  }
  for (const job of cohortJobs) addTrend(trends, trendBucket(job.createdAt, input.group), "submitted");
  for (const job of checkouts) if (job.checkoutAt) addTrend(trends, trendBucket(job.checkoutAt, input.group), "checkouts");
  for (const job of authorized) if (job.authorizedAt) addTrend(trends, trendBucket(job.authorizedAt, input.group), "authorized");
  for (const job of captured) {
    if (!job.capturedAt) continue;
    addTrend(trends, trendBucket(job.capturedAt, input.group), "captured");
    addTrend(trends, trendBucket(job.capturedAt, input.group), "revenueCents", job.capturedCents ?? 0);
  }

  const activity = cohortJobs
    .filter((job) => !input.status || job.status === input.status)
    .filter((job) => !input.source || jobSource(job, input.touch) === input.source)
    .map((job) => ({
      id: job.id,
      service: job.service,
      status: job.status,
      createdAt: job.createdAt,
      checkout: job.checkoutAt != null,
      authorized: job.authorizedAt != null,
      captured: (job.capturedCents ?? 0) > 0,
      delivered: job.deliveredAt != null || job.status === "delivered" || job.status === "completed",
      transferred: job.transferred,
      refund: refundOf(job),
      firstSource: jobSource(job, "first"),
      lastSource: jobSource(job, "last"),
      firstCampaign: job.firstCampaign,
      lastCampaign: job.lastCampaign,
    }));

  const services = ["delivery", "free_item", "junk", "construction"];
  return {
    visitors: landing,
    sessions: serviceSessions.length,
    starts,
    submitted: cohortJobs.length,
    checkouts: checkouts.length,
    authorized: authorized.length,
    captured: captured.length,
    deliveries: deliveries.length,
    transfers: transfers.length,
    revenueCents,
    refundedCents,
    netRevenueCents,
    averageOrderCents: captured.length ? Math.round(revenueCents / captured.length) : null,
    visitorToLead: rate(cohortJobs.length, landing),
    leadToCheckout: rate(cohortJobs.filter((job) => job.checkoutAt != null).length, cohortJobs.length),
    checkoutToPayment: rate(
      cohortJobs.filter((job) => job.checkoutAt != null && job.authorizedAt != null).length,
      cohortJobs.filter((job) => job.checkoutAt != null).length,
    ),
    visitorToPaying: rate(captured.length, landing),
    visitFunnel: visitRows,
    jobFunnel: requestRows,
    biggestDropOff: biggest(visitRows),
    serviceFunnels: services.map((service) => {
      const rows = visitFunnel(
        sessions.filter((row) => row.service === service && (!input.source || sessionSource(row.sessionId) === input.source)),
        input.now,
      );
      return { service, rows, biggestDropOff: biggest(rows) };
    }),
    sources: sources.filter((row) => row.campaign === "All campaigns"),
    campaigns: sources.filter((row) => row.campaign !== "All campaigns"),
    trends: [...trends.values()].sort((left, right) => left.bucket.localeCompare(right.bucket)),
    activity,
  };
}
