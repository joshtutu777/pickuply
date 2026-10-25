import Link from "next/link";
import { Suspense } from "react";
import { StatusChip } from "@/components/admin/status-chip";
import { LoadingMain } from "@/components/loading-main";
import { loadAdminDashboard } from "@/lib/admin/load";
import {
  filterJobs,
  firstName,
  parseRequestFilters,
  paymentStatusLabel,
  pricingAmount,
  pricingMethodLabel,
  readableTime,
  serviceLabel,
  type AdminJob,
  type RequestFilters,
} from "@/lib/admin/ops";
import { pricingMethods, services } from "@/lib/constants";
import { IncludeTestData } from "@/components/admin/include-test-data";
import { includeTestParam } from "@/lib/admin/test-lane";
import { resolveTestLane } from "@/lib/admin/test-lane-server";
import { requireAdmin } from "@/lib/auth/session";

const statuses = [
  ["", "All statuses"],
  ["new", "New requests"],
  ["requested", "Requested"],
  ["in_review", "In review"],
  ["quoted", "Quoted"],
  ["open", "Open for drivers"],
  ["assigned", "Driver assigned"],
  ["en_route", "Driver on the way"],
  ["arrived", "Driver arrived"],
  ["item_check", "Item check"],
  ["in_transit", "On the way"],
  ["delivered", "Delivered"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
  ["disputed", "Disputed"],
] as const;

export default function AdminRequestsPage({ searchParams }: PageProps<"/admin/requests">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Requests searchParams={searchParams} />
    </Suspense>
  );
}

async function Requests({ searchParams }: { searchParams: PageProps<"/admin/requests">["searchParams"] }) {
  await requireAdmin("/admin/requests");
  const raw = await searchParams;
  const lane = await resolveTestLane(includeTestParam(raw.includeTest));
  const data = await loadAdminDashboard(lane);
  const filters = parseRequestFilters(raw);
  if (data.error) {
    return (
      <main className="px-4 py-8">
        <h1 className="font-display text-4xl font-semibold text-ink">Requests</h1>
        <p role="alert" className="mt-6 text-lg text-danger">
          We couldn&apos;t load requests. Try again.
        </p>
      </main>
    );
  }

  const jobs = filterJobs(data.jobs, filters);
  const names = new Map(data.drivers.map((driver) => [driver.id, firstName(driver.name) ?? "Driver"]));
  const title = filters.stage === "jobs" || filters.stage === "active" ? "Jobs & Assignments" : "Requests & Quotes";

  return (
    <main className="px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">{title}</h1>
      {lane === "test" ? null : (
        <IncludeTestData
          include={lane === "all"}
          path="/admin/requests"
          search={new URLSearchParams(
            Object.entries(raw).flatMap(([key, value]) =>
              (Array.isArray(value) ? value : value ? [value] : []).map((item) => [key, item]),
            ),
          ).toString()}
        />
      )}
      <FilterForm filters={filters} />
      {jobs.length === 0 ? (
        <p className="mt-6 rounded-3xl bg-paper-raised p-5 text-base text-muted ring-1 ring-line">
          {filters.status === "new" ? "No new requests" : "No requests match these filters."}
        </p>
      ) : (
        <>
          <ul className="mt-6 space-y-3 md:hidden">
            {jobs.map((job) => (
              <li key={job.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
                <RequestFacts job={job} driverName={job.assignedDriverId ? names.get(job.assignedDriverId) ?? "Driver" : null} now={data.now} />
                <ReviewLink id={job.id} />
              </li>
            ))}
          </ul>
          <div className="mt-6 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] border-separate border-spacing-y-2 text-left">
              <thead>
                <tr className="text-sm font-semibold text-muted">
                  <th className="px-3">Request date</th>
                  <th className="px-3">Service</th>
                  <th className="px-3">Pickup city</th>
                  <th className="px-3">Pricing</th>
                  <th className="px-3">Status</th>
                  <th className="px-3">Payment</th>
                  <th className="px-3">Driver</th>
                  <th className="px-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="bg-paper-raised text-base">
                    <td className="rounded-l-2xl px-3 py-3">{readableTime(job.createdAt, data.now)}</td>
                    <td className="px-3 py-3">{serviceLabel(job.service)}</td>
                    <td className="px-3 py-3">
                      {job.pickupArea}
                      {job.customerId ? (
                        <Link href={`/admin/customers/${job.customerId}`} className="mt-1 block text-sm font-semibold text-brand">
                          Customer
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      {pricingMethodLabel(job.pricingMethod)}
                      {pricingAmount(job) ? <span className="block text-sm text-muted">{pricingAmount(job)}</span> : null}
                    </td>
                    <td className="px-3 py-3">
                      <StatusChip value={job.status} />
                    </td>
                    <td className="px-3 py-3">
                      <StatusChip value={job.paymentStatus} kind="payment" />
                    </td>
                    <td className="px-3 py-3">
                      {job.assignedDriverId ? names.get(job.assignedDriverId) ?? "Driver" : "Unassigned"}
                    </td>
                    <td className="rounded-r-2xl px-3 py-3">
                      <ReviewLink id={job.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}

function RequestFacts({ job, driverName, now }: { job: AdminJob; driverName: string | null; now: number }) {
  const amount = pricingAmount(job);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{readableTime(job.createdAt, now)}</p>
      <p className="text-lg font-semibold text-ink">{serviceLabel(job.service)}</p>
      <p className="text-base text-ink">{job.pickupArea}</p>
      <p className="text-base text-muted">
        {pricingMethodLabel(job.pricingMethod)}
        {amount ? ` · ${amount}` : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <StatusChip value={job.status} />
        <StatusChip value={job.paymentStatus} kind="payment" />
      </div>
      <p className="text-base text-ink">{driverName ? `Driver ${driverName}` : "Unassigned"}</p>
      {job.status === "open" && !job.assignedDriverId && now - Date.parse(job.openedAt ?? job.createdAt) >= 20 * 60 * 1000 ? (
        <p className="text-base font-semibold text-danger">No driver yet</p>
      ) : null}
    </div>
  );
}

function ReviewLink({ id }: { id: string }) {
  return (
    <Link
      href={`/admin/requests/${id}`}
      className="mt-3 inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-5 text-base font-semibold text-white"
    >
      Review request
    </Link>
  );
}

function FilterForm({ filters }: { filters: RequestFilters }) {
  return (
    <form method="get" className="mt-6 grid gap-3 sm:grid-cols-2">
      {filters.stage ? <input type="hidden" name="stage" value={filters.stage} /> : null}
      <label className="block text-base font-semibold text-ink">
        Search city, ZIP, or job ID
        <input
          name="q"
          defaultValue={filters.q}
          className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4 font-normal"
        />
      </label>
      <Select name="status" label="Status" value={filters.status} options={statuses} />
      <Select
        name="service"
        label="Service type"
        value={filters.service}
        options={[["", "All services"], ...services.map((service) => [service.id, service.name] as const)]}
      />
      <Select
        name="pricing"
        label="Pricing method"
        value={filters.pricing}
        options={[["", "All pricing"], ...pricingMethods.map((method) => [method.id, method.label] as const)]}
      />
      <Select
        name="payment"
        label="Payment status"
        value={filters.payment}
        options={[
          ["", "All payments"],
          ["awaiting_payment", paymentStatusLabel("awaiting_payment")],
          ["authorized", paymentStatusLabel("authorized")],
          ["paid", paymentStatusLabel("paid")],
          ["captured", paymentStatusLabel("captured")],
          ["none", paymentStatusLabel("none")],
        ]}
      />
      <Select
        name="sort"
        label="Sort"
        value={filters.sort}
        options={[
          ["newest", "Newest"],
          ["oldest", "Oldest"],
        ]}
      />
      <button
        type="submit"
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-5 text-base font-semibold text-white sm:col-span-2"
      >
        Apply filters
      </button>
    </form>
  );
}

function Select({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <label className="block text-base font-semibold text-ink">
      {label}
      <select
        name={name}
        defaultValue={value}
        className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4 font-normal"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue || "all"} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
