"use client";

import { useEffect, useMemo, useState } from "react";
import { loadVisitFunnelRange } from "@/app/admin/analytics/leads/actions";
import { services } from "@/lib/constants";
import { attributionSources, sourceLabel } from "@/lib/analytics/attribution";
import {
  buildVisitFunnel,
  leadRange,
  unknownVisitCampaign,
  visitRangePresets,
  visitStageLabel,
  visitStages,
  type LeadEvent,
  type LeadVisit,
  type TouchChoice,
  type VisitRangePreset,
  type VisitStage,
} from "@/lib/admin/lead-metrics";

const serviceName = new Map(services.map((service) => [service.id, service.name]));
const field = "mt-1 min-h-12 w-full rounded-2xl border border-line bg-paper px-3 text-base";

type Cache = {
  start: number;
  end: number;
  events: LeadEvent[];
  visits: LeadVisit[];
  capped: boolean;
};

function percent(value: number | null): string {
  if (value == null) return "Not enough data";
  return `${Math.round(value * 1000) / 10}%`;
}

function isPreset(value: string): value is VisitRangePreset {
  return (visitRangePresets as readonly string[]).includes(value);
}

function isStage(value: string): value is VisitStage {
  return (visitStages as readonly string[]).includes(value);
}

export function VisitFunnelPanel({
  initial,
  preset,
  from,
  to,
  source,
  service,
  touch,
  now,
}: {
  initial: Cache;
  preset: VisitRangePreset;
  from: string;
  to: string;
  source: string;
  service: string;
  touch: TouchChoice;
  now: string;
}) {
  const nowDate = useMemo(() => new Date(now), [now]);
  const [datePreset, setDatePreset] = useState<VisitRangePreset>(preset);
  const [dateFrom, setDateFrom] = useState(from);
  const [dateTo, setDateTo] = useState(to);
  const [sourceFilter, setSourceFilter] = useState(source);
  const [campaignFilter, setCampaignFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState(service);
  const [stageFilter, setStageFilter] = useState("");
  const [drill, setDrill] = useState("");
  const [cache, setCache] = useState<Cache>(initial);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const range = leadRange(datePreset, dateFrom, dateTo, nowDate);
    if (range.start.getTime() >= cache.start && range.end.getTime() <= cache.end) return;
    let cancel = false;
    setLoading(true);
    void loadVisitFunnelRange({ preset: datePreset, from: dateFrom, to: dateTo, now })
      .then((result) => {
        if (cancel) return;
        if (!result.ok) {
          setLoadError(result.reason);
          return;
        }
        setLoadError("");
        setCache({
          start: Date.parse(result.start),
          end: Date.parse(result.end),
          events: result.events,
          visits: result.visits,
          capped: result.capped,
        });
      })
      .catch(() => {
        if (!cancel) setLoadError("Visit sessions could not be loaded.");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [cache.end, cache.start, dateFrom, datePreset, dateTo, now, nowDate]);

  const requested = leadRange(datePreset, dateFrom, dateTo, nowDate);
  const covered = requested.start.getTime() >= cache.start && requested.end.getTime() <= cache.end;
  const view = useMemo(() => {
    if (!covered) return null;
    return buildVisitFunnel({
      events: cache.events,
      visits: cache.visits,
      now: nowDate,
      filters: {
        start: requested.start,
        end: requested.end,
        source: attributionSources.includes(sourceFilter as (typeof attributionSources)[number]) ? (sourceFilter as (typeof attributionSources)[number]) : "",
        campaign: campaignFilter,
        service: services.some((item) => item.id === serviceFilter) ? serviceFilter : "",
        stage: isStage(stageFilter) ? stageFilter : "",
        touch,
        drill: isStage(drill) ? drill : "",
      },
    });
  }, [cache.events, cache.visits, campaignFilter, covered, drill, nowDate, requested.end, requested.start, serviceFilter, sourceFilter, stageFilter, touch]);

  const dateLabel =
    datePreset === "today"
      ? "Today"
      : datePreset === "yesterday"
        ? "Yesterday"
        : datePreset === "7d"
          ? "Last 7 days"
          : datePreset === "30d"
            ? "Last 30 days"
            : `${dateFrom || "Custom"} to ${dateTo || dateFrom || "custom"}`;
  const active = [
    dateLabel,
    sourceFilter ? sourceLabel(sourceFilter as "facebook") : "",
    campaignFilter === unknownVisitCampaign ? "Unknown campaign" : campaignFilter,
    serviceFilter ? serviceName.get(serviceFilter as "delivery") ?? "" : "",
    stageFilter && isStage(stageFilter) ? visitStageLabel(stageFilter) : "",
  ].filter(Boolean);

  function resetFilters() {
    setDatePreset(preset);
    setDateFrom(from);
    setDateTo(to);
    setSourceFilter(source);
    setCampaignFilter("");
    setServiceFilter(service);
    setStageFilter("");
    setDrill("");
    setLoadError("");
  }

  function clearFilters() {
    setDatePreset("7d");
    setDateFrom("");
    setDateTo("");
    setSourceFilter("");
    setCampaignFilter("");
    setServiceFilter("");
    setStageFilter("");
    setDrill("");
    setLoadError("");
  }

  const peak = Math.max(1, ...(view?.rows.map((row) => row.reached) ?? [1]));

  return (
    <section aria-labelledby="visit-funnel">
      <h2 id="visit-funnel" className="font-display text-2xl font-semibold text-ink">Visit funnel</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Each row is distinct consented sessions. A session is counted at a step only when that step was stored.
        A visitor who opens the request form directly is not counted as a landing visit.
        Dropped off means the last stored step was this one. Abandoned means that last step has been quiet for 30 minutes, measured from when this page was opened.
        These filters do not change saved requests or payment totals.
      </p>
      <p className="mt-2 text-sm text-muted">Device type is not recorded, so there is no desktop, mobile, or tablet filter.</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className="text-sm font-semibold text-ink">
          Date
          <select className={field} value={datePreset} onChange={(event) => { if (isPreset(event.target.value)) setDatePreset(event.target.value); }}>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {datePreset === "custom" ? (
          <>
            <label className="text-sm font-semibold text-ink">
              From
              <input className={field} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </label>
            <label className="text-sm font-semibold text-ink">
              To
              <input className={field} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </label>
          </>
        ) : null}
        <label className="text-sm font-semibold text-ink">
          Traffic source
          <select className={field} value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
            <option value="">All sources</option>
            {attributionSources.map((item) => (
              <option key={item} value={item}>{sourceLabel(item)}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-ink">
          Campaign
          <select className={field} value={campaignFilter} onChange={(event) => setCampaignFilter(event.target.value)}>
            <option value="">All campaigns</option>
            <option value={unknownVisitCampaign}>Unknown</option>
            {(view?.campaigns ?? []).map((campaign) => (
              <option key={campaign} value={campaign}>{campaign}</option>
            ))}
            {campaignFilter && campaignFilter !== unknownVisitCampaign && !(view?.campaigns ?? []).includes(campaignFilter) ? (
              <option value={campaignFilter}>{campaignFilter}</option>
            ) : null}
          </select>
        </label>
        <label className="text-sm font-semibold text-ink">
          Service type
          <select className={field} value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}>
            <option value="">All services</option>
            {services.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-ink">
          Funnel stage
          <select className={field} value={stageFilter} onChange={(event) => { setStageFilter(event.target.value); setDrill(""); }}>
            <option value="">All stages</option>
            {visitStages.map((stage) => (
              <option key={stage} value={stage}>{visitStageLabel(stage)}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-paper-raised px-5 font-semibold text-ink" onClick={resetFilters}>
          Reset filters
        </button>
        <button type="button" className="inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-paper-raised px-5 font-semibold text-ink" onClick={clearFilters}>
          Clear all filters
        </button>
      </div>
      <p className="mt-3 text-sm text-ink" aria-live="polite">
        Active filters: {active.join(" · ")}
        {loading ? " Updating visit sessions." : ""}
      </p>
      {loadError ? <p className="mt-3 text-base text-danger" role="alert">{loadError}</p> : null}
      {cache.capped ? <p className="mt-3 text-sm text-muted">This range was capped at the newest 5,000 visit events.</p> : null}

      {view?.empty ? (
        <p className="mt-4 rounded-3xl bg-paper-raised p-4 text-base text-ink ring-1 ring-line" role="status">
          No consented visit sessions match these filters. A rejected or unanswered cookie choice is not stored. Saved requests and payments on this page are unchanged.
        </p>
      ) : null}

      {view && !view.empty ? (
        <>
          <p className="mt-4 text-sm text-ink">
            {view.sessions} sessions in this filter.
            {" "}
            {view.overallConversion == null
              ? "Overall conversion to a submitted request is not available."
              : `${percent(view.overallConversion)} of these sessions reached Request submitted.`}
            {view.biggestDropOff ? ` The largest 30-minute drop-off is ${view.biggestDropOff}.` : " No step has reached the 30-minute drop-off threshold."}
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead>
                <tr className="text-muted">
                  <th className="py-2 font-semibold">Stage</th>
                  <th className="py-2 font-semibold">Reached</th>
                  <th className="py-2 font-semibold">Continued</th>
                  <th className="py-2 font-semibold">Dropped off</th>
                  <th className="py-2 font-semibold">Abandoned after 30 min</th>
                  <th className="py-2 font-semibold">Still open</th>
                  <th className="py-2 font-semibold">Next step</th>
                  <th className="py-2 font-semibold">Share of these sessions</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.key} className="border-t border-line">
                    <th className="py-3 pr-3 font-semibold text-ink" scope="row">
                      <button
                        type="button"
                        className="min-h-12 text-left font-semibold text-brand"
                        aria-pressed={drill === row.key}
                        onClick={() => setDrill(row.key)}
                      >
                        {row.label}
                      </button>
                      <span className="mt-1 block h-2 overflow-hidden rounded-full bg-paper">
                        <span className="block h-2 rounded-full bg-brand" style={{ width: `${Math.round((row.reached / peak) * 100)}%` }} />
                      </span>
                    </th>
                    <td className="py-3">{row.reached} sessions</td>
                    <td>{row.continued}</td>
                    <td>{row.abandoned + row.inProgress}</td>
                    <td>{row.abandoned}</td>
                    <td>{row.inProgress}</td>
                    <td>{percent(row.stepRate)}</td>
                    <td>{percent(row.overallRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AbandonChart rows={view.rows} />
          {view.drill ? <DrillDown drill={view.drill} /> : <p className="mt-4 text-sm text-muted">Choose a stage to see where those sessions came from and whether they continued.</p>}
        </>
      ) : null}
    </section>
  );
}

function AbandonChart({ rows }: { rows: { key: string; label: string; abandoned: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.abandoned));
  return (
    <figure className="mt-4 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <figcaption className="font-semibold text-ink">Visit steps abandoned after 30 minutes</figcaption>
      <ul className="mt-4 grid gap-2">
        {rows.map((row) => (
          <li key={row.key}>
            <div className="flex justify-between gap-3 text-sm"><span>{row.label}</span><span>{row.abandoned}</span></div>
            <span className="mt-1 block h-2 rounded-full bg-paper">
              <span className="block h-2 rounded-full bg-brand" style={{ width: `${Math.round((row.abandoned / max) * 100)}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function DrillDown({ drill }: { drill: NonNullable<ReturnType<typeof buildVisitFunnel>["drill"]> }) {
  return (
    <div className="mt-4 rounded-3xl bg-paper-raised p-4 ring-1 ring-line" aria-live="polite">
      <h3 className="font-semibold text-ink">{drill.label}</h3>
      <p className="mt-2 text-sm text-ink">
        {drill.reached} sessions reached this step. {drill.continued} continued. {drill.dropped} dropped off. {drill.abandoned} of those drop-offs have been quiet for 30 minutes.
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Breakdown title="Source" rows={drill.sources} />
        <Breakdown title="Campaign" rows={drill.campaigns} />
        <Breakdown title="Service" rows={drill.services} />
        <Breakdown title="When this step was recorded" rows={drill.times} />
      </div>
      <h4 className="mt-4 font-semibold text-ink">Anonymous sessions</h4>
      <p className="mt-1 text-sm text-muted">These are browser session ids. Names, email addresses, phone numbers, and addresses are not shown.</p>
      <ul className="mt-2 grid gap-1 font-mono text-xs break-all">
        {drill.sessions.map((session) => (
          <li key={session}>{session}</li>
        ))}
      </ul>
      {drill.sessionCount > drill.sessions.length ? (
        <p className="mt-2 text-sm text-muted">{drill.sessionCount - drill.sessions.length} more sessions match this step.</p>
      ) : null}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  return (
    <div>
      <h4 className="font-semibold text-ink">{title}</h4>
      {rows.length === 0 ? <p className="mt-1 text-sm text-muted">Nothing recorded.</p> : null}
      <ul className="mt-2 grid gap-1 text-sm">
        {rows.map((row) => (
          <li key={row.label} className="flex justify-between gap-3">
            <span>{row.label}</span>
            <span>{row.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
