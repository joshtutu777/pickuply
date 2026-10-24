import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { clearFinanceView, saveFinanceView } from "@/app/admin/finance/actions";
import { LoadingMain } from "@/components/loading-main";
import {
  attentionIssues,
  autoCompleteSoon,
  changePercent,
  chipLabel,
  countMoney,
  dailyChart,
  dateWindow,
  filterJobs,
  filtersToParams,
  groupRows,
  holdClass,
  isOverdue,
  ledgerLabel,
  listTotal,
  pageRows,
  parseFinanceFilters,
  paymentBuckets,
  paymentChip,
  payoutBuckets,
  payoutDue,
  previousWindow,
  quickView,
  revenue,
  serviceName,
  showMoney,
  sortJobs,
  type FinanceFilters,
  type FinanceJob,
  type Money,
} from "@/lib/admin/finance";
import { loadFinanceJobs } from "@/lib/admin/finance-load";
import { compareWithStripe } from "@/lib/admin/finance-stripe";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

type FinancePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function FinancePage({ searchParams }: FinancePageProps) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Finance searchParams={searchParams} />
    </Suspense>
  );
}

async function Finance({ searchParams }: FinancePageProps) {
  const session = await requireAdmin("/admin/finance");
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    for (const item of values) params.append(key, item);
  }
  if (!params.has("fresh") && [...params.keys()].length === 0) {
    const supabase = await createClient();
    const saved = await supabase.from("admin_finance_views").select("query").eq("admin_id", session.userId).maybeSingle();
    if (saved.data?.query) redirect(`/admin/finance?${saved.data.query}`);
  }
  params.delete("fresh");
  const filters = parseFinanceFilters(params);
  const loaded = await loadFinanceJobs();
  const now = new Date();
  const window = dateWindow(filters, now);
  const filtered = sortJobs(filterJobs(loaded.jobs, filters, now, window), filters);
  const visible = pageRows(filtered, filters.page);
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const checks = filters.tab === "reconcile" ? await compareWithStripe(filtered) : null;
  const previous = filters.compare && window ? filterJobs(loaded.jobs, filters, now, previousWindow(window)) : [];
  const cities = [...new Set(loaded.jobs.map((job) => job.pickupCity).filter(Boolean))] as string[];
  const zips = [...new Set(loaded.jobs.map((job) => job.pickupZip).filter(Boolean))] as string[];
  const customers = uniquePeople(loaded.jobs, "customer");
  const drivers = uniquePeople(loaded.jobs, "driver");
  const query = filtersToParams(filters).toString();

  return (
    <main className="px-4 py-8">
      <h1 className="font-display text-4xl font-semibold text-ink">Payments</h1>
      <p className="mt-2 max-w-3xl text-base text-muted">
        Amounts come from the ledger and stored Stripe records. A transfer is not a bank payout. Bank payouts are not tied to a job, so that column says Not tracked.
      </p>
      {loaded.error ? <p className="mt-4 text-danger">{loaded.error}</p> : null}
      {params.get("error") === "save" ? <p className="mt-4 text-danger">The filters could not be saved.</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link className="rounded-full bg-paper-raised px-4 py-2 font-semibold ring-1 ring-line" href={`/admin/finance?${quickView("attention")}`}>Needs attention today</Link>
        <Link className="rounded-full bg-paper-raised px-4 py-2 font-semibold ring-1 ring-line" href={`/admin/finance?${quickView("payouts")}`}>This week&apos;s payouts</Link>
        <Link className="rounded-full bg-paper-raised px-4 py-2 font-semibold ring-1 ring-line" href={`/admin/finance?${quickView("refunds")}`}>Refunds this month</Link>
        <Link className="rounded-full bg-paper-raised px-4 py-2 font-semibold ring-1 ring-line" href={`/admin/finance?${quickView("holds")}`}>Unpaid holds</Link>
      </div>
      <nav aria-label="Finance" className="mt-4 flex flex-wrap gap-2">
        {(["overview", "payments", "payouts", "attention", "reconcile"] as const).map((tab) => (
          <Link key={tab} href={tabHref(filters, tab)} className={`rounded-full px-4 py-2 font-semibold ${filters.tab === tab ? "bg-brand text-white" : "bg-paper-raised ring-1 ring-line"}`}>
            {tab === "reconcile" ? "Reconciliation" : tab[0].toUpperCase() + tab.slice(1)}
          </Link>
        ))}
      </nav>
      <FilterForm filters={filters} cities={cities} zips={zips} customers={customers} drivers={drivers} />
      <Chips filters={filters} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="font-semibold">{listTotal(filtered, filters.tab)}</p>
        <a className="font-semibold text-brand" href={`/admin/finance/export?${query}`}>Download CSV</a>
        <form action={saveFinanceView}>
          <input type="hidden" name="query" value={query} />
          <button type="submit" className="font-semibold text-brand">Save filters</button>
        </form>
        <form action={clearFinanceView}>
          <button type="submit" className="font-semibold text-brand">Clear all</button>
        </form>
      </div>
      {filters.pricing === "admin_quote" ? <p className="mt-3">Admin quotes are not stored separately from Get offers, so this filter has no rows.</p> : null}
      {filters.fee === "late_cancel" ? <p className="mt-3">Late-cancel fees are not tracked yet.</p> : null}
      {filters.tab === "overview" ? <Overview jobs={filtered} previous={previous} filters={filters} now={now} /> : null}
      {filters.tab === "payments" ? <PaymentTable jobs={visible} /> : null}
      {filters.tab === "payouts" ? <PayoutTable jobs={visible} now={now} /> : null}
      {filters.tab === "attention" ? <Attention jobs={visible} now={now} /> : null}
      {filters.tab === "reconcile" && checks ? <Reconcile jobs={visible} checks={checks.checks} note={checks.note} /> : null}
      <Pagination filters={filters} pages={pages} />
    </main>
  );
}

function Overview({ jobs, previous, filters, now }: { jobs: FinanceJob[]; previous: FinanceJob[]; filters: FinanceFilters; now: Date }) {
  const payments = paymentBuckets(jobs);
  const before = paymentBuckets(previous);
  const payouts = payoutBuckets(jobs);
  const money = revenue(jobs);
  const pending = {
    awaiting: jobs.filter((job) => paymentChip(job) === "awaiting_payment"),
    held: jobs.filter((job) => paymentChip(job) === "held"),
    auto: jobs.filter((job) => autoCompleteSoon(job, now)),
  };
  const issues = jobs.filter((job) => attentionIssues(job, now).length > 0);
  const chart = dailyChart(jobs);
  const max = Math.max(1, ...chart.flatMap((day) => [("cents" in day.captured ? day.captured.cents : 0), ("cents" in day.refunded ? day.refunded.cents : 0)]));
  return (
    <div className="mt-6 grid gap-4">
      <p className="font-semibold">{issues.length} need attention in this view. Failed captures are not tracked.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Held" value={payments.held} change={filters.compare ? changePercent(payments.held.amount, before.held.amount) : null} />
        <Stat label="Charged" value={payments.charged} change={filters.compare ? changePercent(payments.charged.amount, before.charged.amount) : null} />
        <Stat label="Released" value={payments.released} change={filters.compare ? changePercent(payments.released.amount, before.released.amount) : null} />
        <Stat label="Refunded" value={payments.refunded} change={filters.compare ? changePercent(payments.refunded.amount, before.refunded.amount) : null} />
        <Stat label="Disputed" value={payments.disputed} change={filters.compare ? changePercent(payments.disputed.amount, before.disputed.amount) : null} />
        <Stat label="Awaiting card" value={countMoney(pending.awaiting, (job) => job.priceCents)} change={null} />
        <Stat label="Authorized, not captured" value={payments.held} change={null} />
        <Stat label="Auto-complete due within 24h" value={countMoney(pending.auto, (job) => job.priceCents)} change={null} />
      </div>
      <h2 className="font-display text-2xl font-semibold">Driver payouts</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(payouts).map(([status, value]) => (
          <Stat key={status} label={ledgerLabel[status as keyof typeof ledgerLabel]} value={value} change={null} />
        ))}
      </div>
      <h2 className="font-display text-2xl font-semibold">Pickuply revenue</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MoneyStat label="Platform fees" value={money.platform} />
        <MoneyStat label="Service fees" value={money.service} />
        <MoneyStat label="Stripe processing fees" value={money.stripe} />
        <MoneyStat label="Trip fees captured" value={money.trip} />
        <MoneyStat label="Late-cancel fees" value={money.lateCancel} />
        <MoneyStat label="Refunds" value={money.refunds} />
        <MoneyStat label="Net" value={money.net} />
      </div>
      <h2 className="font-display text-2xl font-semibold">Captured and refunded by day</h2>
      {chart.length === 0 ? <p>No captured or refunded dates in this view.</p> : null}
      <ul className="grid gap-2">
        {chart.map((day) => (
          <li key={day.day} className="grid grid-cols-[7rem_1fr] items-center gap-3">
            <span>{day.day}</span>
            <span className="flex h-3 overflow-hidden rounded-full bg-paper-raised">
              {"cents" in day.captured ? <span className="bg-brand" style={{ width: `${(day.captured.cents / max) * 100}%` }} /> : null}
              {"cents" in day.refunded ? <span className="bg-danger" style={{ width: `${(day.refunded.cents / max) * 100}%` }} /> : null}
            </span>
          </li>
        ))}
      </ul>
      <h2 className="font-display text-2xl font-semibold">Grouped</h2>
      <ul className="grid gap-2">
        {groupRows(jobs, filters.group).map((row) => (
          <li key={row.key}>{row.key} · {row.count} · {showMoney(row.amount)}</li>
        ))}
      </ul>
    </div>
  );
}

function PaymentTable({ jobs }: { jobs: FinanceJob[] }) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr>{["Date", "Job", "Customer", "Driver", "Status", "Total", "Captured", "Refunded", "Hold ends"].map((label) => <th key={label} className="py-2 pr-3">{label}</th>)}</tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const chip = paymentChip(job);
            return (
              <tr key={job.id} className="border-t border-line">
                <td className="py-2 pr-3">{new Date(job.createdAt).toLocaleDateString()}</td>
                <td className="py-2 pr-3"><Link className="font-semibold text-brand" href={`/admin/requests/${job.id}`}>{job.id.slice(0, 8)}</Link></td>
                <td className="py-2 pr-3">
                  {job.customerId ? (
                    <Link href={`/admin/customers/${job.customerId}`} className="font-semibold text-brand">{job.customerFirst ?? "Customer"}</Link>
                  ) : (
                    job.customerFirst ?? "Unavailable"
                  )}
                </td>
                <td className="py-2 pr-3">{job.driverFirst ?? "Unassigned"}</td>
                <td className="py-2 pr-3">{chip ? chipLabel[chip] : "Unavailable"}</td>
                <td className="py-2 pr-3">{job.priceCents == null ? "Unavailable" : showMoney({ cents: job.priceCents })}</td>
                <td className="py-2 pr-3">{job.capturedCents == null ? "Unavailable" : showMoney({ cents: job.capturedCents })}</td>
                <td className="py-2 pr-3">{job.refundedCents == null ? "Unavailable" : showMoney({ cents: job.refundedCents })}</td>
                <td className="py-2 pr-3">{job.captureBefore ? new Date(job.captureBefore).toLocaleString() : "Unavailable"} {job.paymentIntentId ? <a className="text-brand" href={`https://dashboard.stripe.com/test/payments/${job.paymentIntentId}`}>Stripe</a> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {jobs.length === 0 ? <p className="mt-3">No payments match these filters.</p> : null}
    </div>
  );
}

function PayoutTable({ jobs, now }: { jobs: FinanceJob[]; now: Date }) {
  return (
    <div className="mt-6 overflow-x-auto">
      <p className="mb-3">Record a payment outside Stripe, or review a failed transfer, on <Link className="text-brand" href="/admin/payouts">Payouts</Link>. There is no separate retry button. The transfer job retries a failed transfer.</p>
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr>{["Driver", "Job", "Amount", "Ledger", "Transfer", "Bank payout", "Hold", "Due"].map((label) => <th key={label} className="py-2 pr-3">{label}</th>)}</tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className="border-t border-line">
              <td className="py-2 pr-3">{job.driverFirst ?? "Unavailable"}</td>
              <td className="py-2 pr-3"><Link className="text-brand" href={`/admin/requests/${job.id}`}>{job.id.slice(0, 8)}</Link></td>
              <td className="py-2 pr-3">{job.ledgerAmountCents == null ? "Unavailable" : showMoney({ cents: job.ledgerAmountCents })}</td>
              <td className="py-2 pr-3">{job.ledgerStatus ? ledgerLabel[job.ledgerStatus] : "Unavailable"}</td>
              <td className="py-2 pr-3">{job.transferStatus ?? "Not sent"}</td>
              <td className="py-2 pr-3">Not tracked</td>
              <td className="py-2 pr-3">{holdClass(job) ?? job.holdReason ?? ""}</td>
              <td className={`py-2 pr-3 ${isOverdue(job, now) ? "font-semibold text-danger" : ""}`}>{payoutDue(job) ? new Date(payoutDue(job)!).toLocaleDateString() : "Unavailable"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Attention({ jobs, now }: { jobs: FinanceJob[]; now: Date }) {
  return (
    <ul className="mt-6 grid gap-3">
      <li>Failed captures are not tracked. An expired authorization is recorded as an admin alert, not as a new charge.</li>
      {jobs.map((job) => (
        <li key={job.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
          <Link className="font-semibold text-brand" href={`/admin/requests/${job.id}`}>{job.customerFirst ?? "Customer"} · {job.id.slice(0, 8)}</Link>
          <p>{attentionIssues(job, now).join(", ").replaceAll("_", " ")}</p>
        </li>
      ))}
    </ul>
  );
}

function Reconcile({ jobs, checks, note }: { jobs: FinanceJob[]; checks: Awaited<ReturnType<typeof compareWithStripe>>["checks"]; note: string | null }) {
  return (
    <div className="mt-6 overflow-x-auto">
      {note ? <p className="mb-3">{note}</p> : null}
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr>{["Job", "Our capture", "Stripe capture", "Our refund", "Stripe refund", "Our fee", "Stripe fee", "Transfer"].map((label) => <th key={label} className="py-2 pr-3">{label}</th>)}</tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const stripe = checks.get(job.id);
            return (
              <tr key={job.id} className="border-t border-line">
                <td className="py-2 pr-3">{job.id.slice(0, 8)}</td>
                <td className="py-2 pr-3">{job.capturedCents == null ? "Unavailable" : showMoney({ cents: job.capturedCents })}</td>
                <td className="py-2 pr-3">{stripe ? showMoney(stripe.captured) : "Unavailable"} {mismatch(job.capturedCents, stripe?.captured) ? "Mismatch" : ""}</td>
                <td className="py-2 pr-3">{job.refundedCents == null ? "Unavailable" : showMoney({ cents: job.refundedCents })}</td>
                <td className="py-2 pr-3">{stripe ? showMoney(stripe.refunded) : "Unavailable"} {mismatch(job.refundedCents, stripe?.refunded) ? "Mismatch" : ""}</td>
                <td className="py-2 pr-3">{job.stripeFeeCents == null ? "Unavailable" : showMoney({ cents: job.stripeFeeCents })}</td>
                <td className="py-2 pr-3">{stripe ? showMoney(stripe.fee) : "Unavailable"} {mismatch(job.stripeFeeCents, stripe?.fee) ? "Mismatch" : ""}</td>
                <td className="py-2 pr-3">{stripe ? showMoney(stripe.transfer) : "Not tracked"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function mismatch(ours: number | null, theirs: Money | undefined): boolean {
  if (ours == null || !theirs || !("cents" in theirs)) return false;
  return ours !== theirs.cents;
}

function Stat({ label, value, change }: { label: string; value: { count: number; amount: Money }; change: string | null }) {
  return (
    <div className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold">{showMoney(value.amount)}</p>
      <p>{value.count} {change ? `· ${change}` : ""}</p>
    </div>
  );
}

function MoneyStat({ label, value }: { label: string; value: Money }) {
  return (
    <div className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold">{showMoney(value)}</p>
    </div>
  );
}

function FilterForm({
  filters,
  cities,
  zips,
  customers,
  drivers,
}: {
  filters: FinanceFilters;
  cities: string[];
  zips: string[];
  customers: { id: string; name: string }[];
  drivers: { id: string; name: string }[];
}) {
  return (
    <form className="mt-4 grid gap-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line md:grid-cols-3" method="get">
      <input type="hidden" name="tab" value={filters.tab} />
      <label>Date range<select name="range" defaultValue={filters.range} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">This week</option><option value="last_week">Last week</option><option value="month">This month</option><option value="last_month">Last month</option><option value="custom">Custom</option></select></label>
      <label>From<input name="from" type="date" defaultValue={filters.from} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3" /></label>
      <label>To<input name="to" type="date" defaultValue={filters.to} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3" /></label>
      <label>Which date<select name="date" defaultValue={filters.date} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="requested">Requested</option><option value="booked">Booked</option><option value="captured">Captured</option><option value="refunded">Refunded</option><option value="paid_out">Paid out</option></select></label>
      <label>Service<select name="service" defaultValue={filters.service} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="">Any</option><option value="delivery">{"Pickup & Delivery"}</option><option value="free_item">Free-Item Pickup</option><option value="construction">Store Delivery</option><option value="junk">Junk Removal</option></select></label>
      <label>Pricing<select name="pricing" defaultValue={filters.pricing} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="">Any</option><option value="quote">Get offers</option><option value="fixed">Fixed price</option><option value="range">Budget range</option><option value="admin_quote">Admin quote</option></select></label>
      <label>Payment status<select name="payment" defaultValue={filters.paymentStatus} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="">Any</option><option value="awaiting_payment">Awaiting payment</option><option value="held">Held</option><option value="charged">Charged</option><option value="partially_charged">Partially charged</option><option value="released">Released</option><option value="refunded">Refunded</option><option value="refunded_full">Refunded full</option><option value="refunded_partial">Refunded partial</option><option value="disputed">Disputed</option><option value="failed">Failed</option></select></label>
      <label>Ledger<select name="ledger" defaultValue={filters.ledgerStatus} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="">Any</option>{Object.entries(ledgerLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Sort<select name="sort" defaultValue={filters.sort} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="amount_desc">Amount high to low</option><option value="amount_asc">Amount low to high</option><option value="due">Due soonest</option></select></label>
      <label>Search<input name="q" defaultValue={filters.q} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3" placeholder="Job, name, Stripe id, case" /></label>
      <label>Minimum $<input name="min" defaultValue={filters.amountMin} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3" /></label>
      <label>Maximum $<input name="max" defaultValue={filters.amountMax} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3" /></label>
      <label>Customer<select name="customer" defaultValue={filters.customer} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="">Any</option>{customers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label>Driver<select name="driver" defaultValue={filters.driver} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="">Any</option>{drivers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label>Hold expiring<select name="hold" defaultValue={filters.hold} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="">Any</option><option value="24h">Within 24 hours</option><option value="3d">Within 3 days</option><option value="7d">Within 7 days</option></select></label>
      <label>Report or dispute<select name="report" defaultValue={filters.report} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="">Any</option><option value="yes">Yes</option><option value="no">No</option></select></label>
      <label>Fee<select name="fee" defaultValue={filters.fee} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="">Any</option><option value="normal">Normal job</option><option value="trip">Trip fee</option><option value="late_cancel">Late-cancel fee</option></select></label>
      <label>Transfer<select name="transfer" defaultValue={filters.transferStatus} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="">Any</option><option value="created">Created</option><option value="failed">Failed</option><option value="reversed">Reversed</option></select></label>
      <label>Hold reason<select name="reason" defaultValue={filters.holdReason} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="">Any</option><option value="dispute">Dispute</option><option value="report">Report</option><option value="setup">Payout setup missing</option><option value="admin">Admin hold</option></select></label>
      <label>Overdue<select name="overdue" defaultValue={filters.overdue} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="">Any</option><option value="yes">Yes</option><option value="no">No</option></select></label>
      <label>Payout setup<select name="setup" defaultValue={filters.payoutSetup} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="">Any</option><option value="done">Done</option><option value="missing">Not done</option></select></label>
      <label>Issue<select name="issue" defaultValue={filters.issue} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="">Any</option><option value="hold_expiring">Hold expiring</option><option value="payment_overdue">Payment overdue</option><option value="failed_transfer">Failed transfer</option><option value="long_held">Long-held payout</option><option value="recovery_due">Recovery due</option><option value="dispute">Stripe dispute</option></select></label>
      <label>Group by<select name="group" defaultValue={filters.group} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3"><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="city">City</option><option value="service">Service type</option><option value="driver">Driver</option></select></label>
      <label className="flex min-h-12 items-center gap-2 font-semibold"><input type="checkbox" name="compare" value="1" defaultChecked={filters.compare} />Compare to previous period</label>
      <fieldset className="md:col-span-3">
        <legend className="font-semibold">City</legend>
        <div className="mt-2 flex flex-wrap gap-3">{cities.map((city) => <label key={city} className="flex items-center gap-2"><input type="checkbox" name="city" value={city} defaultChecked={filters.cities.includes(city)} />{city}</label>)}</div>
      </fieldset>
      <fieldset className="md:col-span-3">
        <legend className="font-semibold">Pickup ZIP</legend>
        <div className="mt-2 flex flex-wrap gap-3">{zips.map((zip) => <label key={zip} className="flex items-center gap-2"><input type="checkbox" name="zip" value={zip} defaultChecked={filters.zips.includes(zip)} />{zip}</label>)}</div>
      </fieldset>
      <button type="submit" className="min-h-12 rounded-full bg-brand px-5 font-semibold text-white">Apply filters</button>
    </form>
  );
}

function Chips({ filters }: { filters: FinanceFilters }) {
  const chips: { label: string; href: string }[] = [];
  const drop = (key: string) => {
    const next = filtersToParams({ ...filters, page: 1 });
    next.delete(key);
    return `/admin/finance?${next.toString()}`;
  };
  if (filters.q) chips.push({ label: `Search: ${filters.q}`, href: drop("q") });
  if (filters.service) chips.push({ label: serviceName(filters.service), href: drop("service") });
  if (filters.paymentStatus) chips.push({ label: filters.paymentStatus, href: drop("payment") });
  if (filters.cities.length) chips.push({ label: filters.cities.join(", "), href: drop("city") });
  if (filters.zips.length) chips.push({ label: filters.zips.join(", "), href: drop("zip") });
  if (!chips.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip.label}><Link className="rounded-full bg-brand-soft px-3 py-1 font-semibold text-brand-dark" href={chip.href}>{chip.label} ×</Link></li>
      ))}
    </ul>
  );
}

function Pagination({ filters, pages }: { filters: FinanceFilters; pages: number }) {
  if (pages < 2) return null;
  return (
    <p className="mt-4 flex gap-3">
      {filters.page > 1 ? <Link href={pageHref(filters, filters.page - 1)}>Previous</Link> : null}
      <span>Page {filters.page} of {pages}</span>
      {filters.page < pages ? <Link href={pageHref(filters, filters.page + 1)}>Next</Link> : null}
    </p>
  );
}

function tabHref(filters: FinanceFilters, tab: FinanceFilters["tab"]) {
  return `/admin/finance?${filtersToParams({ ...filters, tab, page: 1 }).toString()}`;
}

function pageHref(filters: FinanceFilters, page: number) {
  return `/admin/finance?${filtersToParams({ ...filters, page }).toString()}`;
}

function uniquePeople(jobs: FinanceJob[], kind: "customer" | "driver") {
  const map = new Map<string, string>();
  for (const job of jobs) {
    const id = kind === "customer" ? job.customerId : job.driverId;
    const name = kind === "customer" ? job.customerFirst : job.driverFirst;
    if (id && name) map.set(id, name);
  }
  return [...map.entries()].map(([id, name]) => ({ id, name }));
}
