import { Suspense } from "react";
import { LeadReportView } from "@/components/admin/lead-report";
import { IncludeTestData } from "@/components/admin/include-test-data";
import { LoadingMain } from "@/components/loading-main";
import { includeTestParam } from "@/lib/admin/test-lane";
import { resolveTestLane } from "@/lib/admin/test-lane-server";
import { loadLeadAnalytics } from "@/lib/admin/lead-load";
import {
  buildLeadReport,
  easternDay,
  leadRange,
  leadTimeZone,
  rangePresets,
  trendGroups,
  visitRangePresets,
  type RangePreset,
  type TouchChoice,
  type TrendGroup,
  type VisitRangePreset,
} from "@/lib/admin/lead-metrics";
import { attributionSources, sourceLabel } from "@/lib/analytics/attribution";
import { services } from "@/lib/constants";
import { requireAdmin } from "@/lib/auth/session";

const statuses = ["requested", "in_review", "quoted", "open", "assigned", "en_route", "arrived", "item_check", "in_transit", "delivered", "completed", "cancelled", "disputed"];

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function choice<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export default function LeadAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <LeadAnalytics searchParams={searchParams} />
    </Suspense>
  );
}

async function LeadAnalytics({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin("/admin/analytics/leads");
  const query = await searchParams;
  const preset = choice(one(query.range), rangePresets, "7d");
  const group = choice(one(query.group), trendGroups, "day");
  const touch = choice(one(query.touch), ["first", "last"] as const, "last");
  const service = services.some((item) => item.id === one(query.service)) ? one(query.service) : "";
  const status = statuses.includes(one(query.status)) ? one(query.status) : "";
  const source = attributionSources.includes(one(query.source) as (typeof attributionSources)[number]) ? one(query.source) : "";
  const from = one(query.from);
  const to = one(query.to);
  const lane = await resolveTestLane(includeTestParam(one(query.includeTest)));
  const now = new Date();
  const range = leadRange(preset, from, to, now);
  const loaded = await loadLeadAnalytics({ start: range.start, end: range.end, lane });
  const report = buildLeadReport({
    events: loaded.events,
    visits: loaded.visits,
    jobs: loaded.jobs,
    start: range.start,
    end: range.end,
    now,
    group,
    touch,
    service,
    status,
    source,
  });
  const search = new URLSearchParams();
  search.set("range", preset);
  if (from) search.set("from", from);
  if (to) search.set("to", to);
  search.set("group", group);
  search.set("touch", touch);
  if (service) search.set("service", service);
  if (status) search.set("status", status);
  if (source) search.set("source", source);

  return (
    <main className="px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink">Leads and conversions</h1>
      <p className="mt-3 max-w-3xl text-base text-muted">
        Saved requests, checkout, authorization, capture, refunds, delivery, and transfers come from Pickuply&apos;s database.
        Visit steps are stored only after the visitor allows analytics cookies. A rejected or unanswered choice creates no visit record. Times on this page are {leadTimeZone}.
        Net captured revenue means gross captured payments minus refunds currently recorded on those payments. It is not profit and it is not a bank deposit.
        A request with no stored campaign stays Unknown. A missing source is not guessed from a click id.
      </p>
      {lane === "test" ? null : (
        <IncludeTestData include={lane === "all"} path="/admin/analytics/leads" search={search.toString()} />
      )}
      {loaded.visitorStore === "missing" ? (
        <p className="mt-4 rounded-2xl bg-paper-raised p-4 text-base text-ink ring-1 ring-line" role="status">
          Visit and campaign tracking is not installed in the database yet. Request, payment, and delivery counts below still use saved jobs.
        </p>
      ) : null}
      {loaded.visitorStore === "unavailable" ? (
        <p className="mt-4 text-base text-danger" role="alert">Visit events could not be loaded.</p>
      ) : null}
      {loaded.jobError ? <p className="mt-4 text-base text-danger" role="alert">{loaded.jobError}</p> : null}
      {loaded.capped ? <p className="mt-4 text-sm text-muted">This range was capped at the newest 2,000 jobs or 5,000 visit events.</p> : null}
      <FilterForm preset={preset} group={group} touch={touch} service={service} status={status} source={source} from={from} to={to} />
      <div className="mt-8">
        <LeadReportView
          report={report}
          events={loaded.events}
          visits={loaded.visits}
          coverageStart={range.start.toISOString()}
          coverageEnd={range.end.toISOString()}
          preset={visitPreset(preset)}
          from={visitPreset(preset) === "custom" ? easternDay(range.start) : from}
          to={visitPreset(preset) === "custom" ? easternDay(new Date(range.end.getTime() - 1)) : to}
          source={source}
          service={service}
          touch={touch}
          now={now.toISOString()}
          capped={loaded.visitCapped}
        />
      </div>
    </main>
  );
}

function visitPreset(preset: RangePreset): VisitRangePreset {
  return (visitRangePresets as readonly string[]).includes(preset) ? (preset as VisitRangePreset) : "custom";
}

function FilterForm({
  preset,
  group,
  touch,
  service,
  status,
  source,
  from,
  to,
}: {
  preset: RangePreset;
  group: TrendGroup;
  touch: TouchChoice;
  service: string;
  status: string;
  source: string;
  from: string;
  to: string;
}) {
  const field = "min-h-12 w-full rounded-2xl border border-line bg-paper px-3 text-base";
  return (
    <form className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
      <label className="text-sm font-semibold text-ink">
        Dates
        <select name="range" defaultValue={preset} className={`mt-1 ${field}`}>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="month">This month</option>
          <option value="last_month">Last month</option>
          <option value="custom">Custom range</option>
        </select>
      </label>
      <label className="text-sm font-semibold text-ink">
        From
        <input name="from" type="date" defaultValue={from} className={`mt-1 ${field}`} />
      </label>
      <label className="text-sm font-semibold text-ink">
        To
        <input name="to" type="date" defaultValue={to} className={`mt-1 ${field}`} />
      </label>
      <label className="text-sm font-semibold text-ink">
        Group trends
        <select name="group" defaultValue={group} className={`mt-1 ${field}`}>
          <option value="hour">Hour</option>
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
        </select>
      </label>
      <label className="text-sm font-semibold text-ink">
        Attribution
        <select name="touch" defaultValue={touch} className={`mt-1 ${field}`}>
          <option value="last">Last touch</option>
          <option value="first">First touch</option>
        </select>
      </label>
      <label className="text-sm font-semibold text-ink">
        Service
        <select name="service" defaultValue={service} className={`mt-1 ${field}`}>
          <option value="">All services</option>
          {services.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm font-semibold text-ink">
        Request status
        <select name="status" defaultValue={status} className={`mt-1 ${field}`}>
          <option value="">Any status</option>
          {statuses.map((item) => (
            <option key={item} value={item}>{item.replaceAll("_", " ")}</option>
          ))}
        </select>
      </label>
      <label className="text-sm font-semibold text-ink">
        Source
        <select name="source" defaultValue={source} className={`mt-1 ${field}`}>
          <option value="">All sources</option>
          {attributionSources.map((item) => (
            <option key={item} value={item}>{sourceLabel(item)}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white sm:col-span-2 lg:col-span-1">
        Update
      </button>
    </form>
  );
}
