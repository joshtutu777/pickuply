import Link from "next/link";
import { VisitFunnelPanel } from "@/components/admin/visit-funnel";
import { services } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import { sourceLabel } from "@/lib/analytics/attribution";
import {
  jobStageLabel,
  visitStageLabel,
  type FunnelRow,
  type LeadEvent,
  type LeadReport,
  type LeadVisit,
  type TouchChoice,
  type TrendPoint,
  type VisitRangePreset,
} from "@/lib/admin/lead-metrics";

const serviceName = new Map(services.map((service) => [service.id, service.name]));

function percent(value: number | null): string {
  if (value == null) return "Not enough data";
  return `${Math.round(value * 1000) / 10}%`;
}

function money(cents: number | null): string {
  if (cents == null) return "Not enough data";
  return formatCents(cents);
}

function Card({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <h2 className="text-sm font-semibold text-muted">{label}</h2>
      <p className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">{value}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">{detail}</p>
    </article>
  );
}

function FunnelTable({ rows, abandonLabel }: { rows: FunnelRow[]; abandonLabel: string }) {
  const peak = Math.max(1, ...rows.map((row) => row.reached));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-left text-sm">
        <thead>
          <tr className="text-muted">
            <th className="py-2 font-semibold">Stage</th>
            <th className="py-2 font-semibold">Reached</th>
            <th className="py-2 font-semibold">Continued</th>
            <th className="py-2 font-semibold">{abandonLabel}</th>
            <th className="py-2 font-semibold">Still open</th>
            <th className="py-2 font-semibold">Next step</th>
            <th className="py-2 font-semibold">From the start</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-line">
              <th className="py-3 pr-3 font-semibold text-ink" scope="row">
                {row.label}
                <span className="mt-1 block h-2 overflow-hidden rounded-full bg-paper">
                  <span className="block h-2 rounded-full bg-brand" style={{ width: `${Math.round((row.reached / peak) * 100)}%` }} />
                </span>
              </th>
              <td className="py-3">{row.reached} {row.unit}</td>
              <td>{row.continued}</td>
              <td>{row.abandoned}</td>
              <td>{row.inProgress}</td>
              <td>{percent(row.stepRate)}</td>
              <td>{percent(row.overallRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Chart({ title, points, field, moneyValues = false }: { title: string; points: TrendPoint[]; field: keyof TrendPoint; moneyValues?: boolean }) {
  const values = points.map((point) => Number(point[field]));
  const max = Math.max(1, ...values);
  return (
    <figure className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <figcaption className="font-semibold text-ink">{title}</figcaption>
      {points.length === 0 ? <p className="mt-3 text-sm text-muted">No activity in this range.</p> : null}
      <div className="mt-4 flex h-36 items-end gap-1 overflow-x-auto">
        {points.map((point) => {
          const value = Number(point[field]);
          const shown = moneyValues ? formatCents(value) : String(value);
          return (
            <div key={point.bucket} className="flex w-8 shrink-0 flex-col items-center justify-end">
              <div
                className="w-5 rounded-t-lg bg-brand"
                style={{ height: `${Math.max(4, Math.round((value / max) * 112))}px` }}
                title={`${point.bucket}: ${shown}`}
              />
              <span className="sr-only">{point.bucket}: {shown}</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

export function LeadReportView({
  report,
  events,
  visits,
  coverageStart,
  coverageEnd,
  preset,
  from,
  to,
  source,
  service,
  touch,
  now,
  capped,
}: {
  report: LeadReport;
  events: LeadEvent[];
  visits: LeadVisit[];
  coverageStart: string;
  coverageEnd: string;
  preset: VisitRangePreset;
  from: string;
  to: string;
  source: string;
  service: string;
  touch: TouchChoice;
  now: string;
  capped: boolean;
}) {
  const empty = report.visitors === 0 && report.sessions === 0 && report.submitted === 0 && report.captured === 0;
  return (
    <div className="grid gap-8">
      {empty ? (
        <p className="rounded-3xl bg-paper-raised p-4 text-base text-ink ring-1 ring-line" role="status">
          Nothing was recorded in this date range. Saved requests appear from existing jobs. Visit and campaign rows appear only after a visitor allows analytics cookies.
        </p>
      ) : null}
      <section aria-label="Summary">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Card label="Landing sessions" value={String(report.visitors)} detail="Distinct sessions that loaded the homepage after allowing analytics cookies. A rejected cookie choice is not counted." />
          <Card label="Unique sessions" value={String(report.sessions)} detail="Distinct consented sessions with any tracked visit step in this range. This is not a count of people." />
          <Card label="Request starts" value={String(report.starts)} detail="Sessions that opened the request form. Counted once per session." />
          <Card label="Requests saved" value={String(report.submitted)} detail="Jobs created in this range. This is the database row, not the browser event." />
          <Card label="Checkout sessions" value={String(report.checkouts)} detail="Jobs whose checkout session was recorded in this range. Repeats for the same job count once." />
          <Card label="Payment authorizations" value={String(report.authorized)} detail="Jobs whose card was authorized in this range. An authorization is a hold, not revenue." />
          <Card label="Payments captured" value={String(report.captured)} detail="Jobs with a stored capture time and a captured amount above zero in this range." />
          <Card label="Completed deliveries" value={String(report.deliveries)} detail="Jobs marked delivered or completed in this range." />
          <Card label="Completed transfers" value={String(report.transfers)} detail="Driver ledger rows marked transferred in this range. A Stripe transfer is not a bank deposit." />
          <Card label="Gross captured revenue" value={formatCents(report.revenueCents)} detail="Sum of captured amounts for captures in this range, before refunds." />
          <Card label="Refunded amount" value={formatCents(report.refundedCents)} detail="Refunds stored on those same captured jobs. A refund does not change the gross amount." />
          <Card label="Net captured revenue" value={formatCents(report.netRevenueCents)} detail="Gross captured payments in this range minus refunds currently recorded on those same payments. This is not profit, and it is not a bank deposit. A refund recorded later changes this number the next time the page is opened." />
          <Card label="Average captured order" value={money(report.averageOrderCents)} detail="Gross captured payments divided by the number of captured jobs in this range. Refunds are not removed from this average." />
          <Card label="Landing to saved request" value={percent(report.visitorToLead)} detail="Saved jobs created in this range divided by landing sessions. The two counts use different units." />
          <Card label="Saved request to checkout" value={percent(report.leadToCheckout)} detail="Jobs created in this range that have a checkout, divided by jobs created in this range." />
          <Card label="Checkout to authorization" value={percent(report.checkoutToPayment)} detail="Jobs in the saved cohort that were authorized, divided by jobs in that cohort with a checkout." />
          <Card label="Landing to captured payment" value={percent(report.visitorToPaying)} detail="Captured jobs in this range divided by landing sessions. This is not return on ad spend." />
        </div>
      </section>

      <VisitFunnelPanel
        initial={{ start: Date.parse(coverageStart), end: Date.parse(coverageEnd), events, visits, capped }}
        preset={preset}
        from={from}
        to={to}
        source={source}
        service={service}
        touch={touch}
        now={now}
      />

      <section aria-labelledby="request-funnel">
        <h2 id="request-funnel" className="font-display text-2xl font-semibold text-ink">Saved request funnel</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          These are jobs created in the range, not sessions and not extra payment attempts.
          A saved request without a checkout stays open. It is not called abandoned.
          Checkout is stopped only after the payment window has passed with no authorization.
          Authorized is not the same as captured.
        </p>
        <FunnelTable rows={report.jobFunnel} abandonLabel="Checkout window passed" />
      </section>

      <section aria-labelledby="service-funnel">
        <h2 id="service-funnel" className="font-display text-2xl font-semibold text-ink">Where each service drops off</h2>
        <div className="mt-4 grid gap-4">
          {report.serviceFunnels.map((service) => (
            <article key={service.service} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
              <h3 className="font-semibold text-ink">{serviceName.get(service.service as "delivery") ?? service.service}</h3>
              <p className="mt-1 text-sm text-muted">
                {service.biggestDropOff ? `Largest 30-minute drop-off: ${service.biggestDropOff}.` : "No 30-minute drop-off in this range."}
              </p>
              <ul className="mt-3 grid gap-1 text-sm">
                {service.rows.map((row) => (
                  <li key={row.key} className="flex justify-between gap-3">
                    <span>{visitStageLabel(row.key as "landing_viewed")}</span>
                    <span>{row.reached} reached · {row.abandoned} abandoned</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="trends">
        <h2 id="trends" className="font-display text-2xl font-semibold text-ink">Trends</h2>
        <p className="mt-2 text-sm text-muted">Buckets use Eastern time. Hover or focus a bar for the exact bucket.</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <Chart title="Landing sessions" points={report.trends} field="visitors" />
          <Chart title="Request starts" points={report.trends} field="starts" />
          <Chart title="Requests saved" points={report.trends} field="submitted" />
          <Chart title="Checkouts started" points={report.trends} field="checkouts" />
          <Chart title="Payments authorized" points={report.trends} field="authorized" />
          <Chart title="Payments captured" points={report.trends} field="captured" />
          <Chart title="Captured revenue" points={report.trends} field="revenueCents" moneyValues />
          <RateChart points={report.trends} />
          <ServiceChart report={report} />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead>
              <tr className="text-muted">
                <th className="py-2">When</th>
                <th>Landing</th>
                <th>Starts</th>
                <th>Saved</th>
                <th>Checkouts</th>
                <th>Authorized</th>
                <th>Captured</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {report.trends.map((point) => (
                <tr key={point.bucket} className="border-t border-line">
                  <th className="py-2 font-semibold" scope="row">{point.bucket}</th>
                  <td>{point.visitors}</td>
                  <td>{point.starts}</td>
                  <td>{point.submitted}</td>
                  <td>{point.checkouts}</td>
                  <td>{point.authorized}</td>
                  <td>{point.captured}</td>
                  <td>{formatCents(point.revenueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="sources">
        <h2 id="sources" className="font-display text-2xl font-semibold text-ink">Sources and campaigns</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Facebook, Instagram, Google, Direct, Referral, Other, and Unknown are the only source groups.
          Unknown means the visit or request had no usable campaign or referrer. A click id is not turned into a campaign.
          Conversion rate is captured jobs divided by landing sessions for that row. Advertising spend is not loaded, so there is no return on ad spend.
        </p>
        <SourceTable rows={report.sources} />
        <h3 className="mt-6 font-semibold text-ink">Campaign, ad set, and ad</h3>
        <p className="mt-1 text-sm text-muted">A row appears only when a campaign name or a numeric Meta id was stored. Otherwise the source total above stays Unknown for that detail.</p>
        {report.campaigns.length === 0 ? <p className="mt-3 text-sm text-muted">No campaign, ad set, or ad id was stored in this range.</p> : <SourceTable rows={report.campaigns} detailed />}
      </section>

      <section aria-labelledby="activity">
        <h2 id="activity" className="font-display text-2xl font-semibold text-ink">Saved requests</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          This list is saved jobs only. It does not show an anonymous browsing history.
          Open a request for the full admin record. Times are Eastern.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[64rem] text-left text-sm">
            <thead>
              <tr className="text-muted">
                <th className="py-2">Request</th>
                <th>Service</th>
                <th>Saved</th>
                <th>Status</th>
                <th>Checkout</th>
                <th>Authorized</th>
                <th>Captured</th>
                <th>Delivered</th>
                <th>Transfer</th>
                <th>Refund</th>
                <th>First source</th>
                <th>Last source</th>
              </tr>
            </thead>
            <tbody>
              {report.activity.length === 0 ? (
                <tr>
                  <td className="py-4 text-muted" colSpan={12}>No saved requests match these filters.</td>
                </tr>
              ) : null}
              {report.activity.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <th className="py-3 font-semibold" scope="row">
                    <Link className="text-brand" href={`/admin/requests/${row.id}`}>{row.id.slice(0, 8)}</Link>
                  </th>
                  <td>{serviceName.get(row.service as "delivery") ?? row.service}</td>
                  <td>{new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(row.createdAt))}</td>
                  <td>{row.status.replaceAll("_", " ")}</td>
                  <td>{row.checkout ? "Yes" : "No"}</td>
                  <td>{row.authorized ? "Yes" : "No"}</td>
                  <td>{row.captured ? "Yes" : "No"}</td>
                  <td>{row.delivered ? "Yes" : "No"}</td>
                  <td>{row.transferred ? "Recorded" : "No"}</td>
                  <td>{row.refund === "none" ? "None" : row.refund === "partial" ? "Partial" : "Full"}</td>
                  <td>{sourceLabel(row.firstSource)}{row.firstCampaign ? ` · ${row.firstCampaign}` : ""}</td>
                  <td>{sourceLabel(row.lastSource)}{row.lastCampaign ? ` · ${row.lastCampaign}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-sm text-muted">Stage names: {visitStagesList()} Job stages: {jobStagesList()}.</p>
    </div>
  );
}

function visitStagesList(): string {
  return ["landing_viewed", "request_viewed", "request_started", "service_selected", "what_completed", "where_completed", "price_reached", "verify_reached", "request_submitted"].map((stage) => visitStageLabel(stage as "landing_viewed")).join(", ");
}

function jobStagesList(): string {
  return ["request_saved", "checkout_started", "payment_authorized", "payment_captured", "delivery_completed"].map((stage) => jobStageLabel(stage as "request_saved")).join(", ");
}

function RateChart({ points }: { points: TrendPoint[] }) {
  const rates = points.map((point) => ({
    bucket: point.bucket,
    rate: point.visitors > 0 ? Math.round((point.submitted / point.visitors) * 1000) / 10 : null,
  }));
  const max = Math.max(1, ...rates.map((point) => point.rate ?? 0));
  return (
    <figure className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <figcaption className="font-semibold text-ink">Saved requests per landing session</figcaption>
      <p className="mt-1 text-sm text-muted">Each bar is saved jobs in that bucket divided by landing sessions. It is blank when that bucket had no landing session.</p>
      <div className="mt-4 flex h-36 items-end gap-1 overflow-x-auto">
        {rates.map((point) => (
          <div key={point.bucket} className="flex w-8 shrink-0 flex-col items-center justify-end" title={point.rate == null ? `${point.bucket}: not enough data` : `${point.bucket}: ${point.rate}%`}>
            <div className="w-5 rounded-t-lg bg-brand" style={{ height: `${point.rate == null ? 4 : Math.max(4, Math.round((point.rate / max) * 112))}px` }} />
          </div>
        ))}
      </div>
    </figure>
  );
}

function ServiceChart({ report }: { report: LeadReport }) {
  const counts = services.map((service) => ({
    name: service.name,
    count: report.activity.filter((row) => row.service === service.id).length,
  }));
  const max = Math.max(1, ...counts.map((item) => item.count));
  return (
    <figure className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <figcaption className="font-semibold text-ink">Saved requests by service</figcaption>
      <ul className="mt-4 grid gap-2">
        {counts.map((item) => (
          <li key={item.name}>
            <div className="flex justify-between text-sm"><span>{item.name}</span><span>{item.count}</span></div>
            <span className="mt-1 block h-2 rounded-full bg-paper">
              <span className="block h-2 rounded-full bg-brand" style={{ width: `${Math.round((item.count / max) * 100)}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function SourceTable({ rows, detailed = false }: { rows: LeadReport["sources"]; detailed?: boolean }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[52rem] text-left text-sm">
        <thead>
          <tr className="text-muted">
            <th className="py-2">Source</th>
            {detailed ? <th>Campaign</th> : null}
            {detailed ? <th>Ad set</th> : null}
            {detailed ? <th>Ad</th> : null}
            <th>Landing</th>
            <th>Starts</th>
            <th>Saved</th>
            <th>Authorized</th>
            <th>Captured</th>
            <th>Revenue</th>
            <th>Captured / landing</th>
            <th>Average order</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="py-4 text-muted" colSpan={detailed ? 12 : 9}>No source rows for this filter.</td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={`${row.source}-${row.campaign}-${row.adset}-${row.ad}`} className="border-t border-line">
              <th className="py-3 font-semibold" scope="row">{row.label}</th>
              {detailed ? <td>{row.campaign}</td> : null}
              {detailed ? <td>{row.adset || "Unknown"}</td> : null}
              {detailed ? <td>{row.ad || "Unknown"}</td> : null}
              <td>{row.visitors}</td>
              <td>{row.starts}</td>
              <td>{row.submitted}</td>
              <td>{row.authorized}</td>
              <td>{row.captured}</td>
              <td>{formatCents(row.revenueCents)}</td>
              <td>{percent(row.conversionRate)}</td>
              <td>{money(row.averageOrderCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
