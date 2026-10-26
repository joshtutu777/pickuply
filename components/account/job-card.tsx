import Link from "next/link";
import { StatusPill } from "@/components/mobile/status-pill";
import { serviceById, type ServiceId } from "@/lib/constants";
import type { JobSummary } from "@/lib/data/job-queries";
import { customerCardAction, customerJobTab, customerListStatus } from "@/lib/jobs/customer-tabs";
import { formatCents } from "@/lib/money";
import { formatUsDay, formatUsWhen } from "@/lib/time/when";

export function CustomerJobCard({
  job,
  driverName,
}: {
  job: JobSummary;
  driverName?: string | null;
}) {
  const service = serviceById(job.service as ServiceId);
  const tab = customerJobTab({ status: job.status, retired: job.test_retired_at != null });
  const status = customerListStatus({
    status: job.status,
    pricingMethod: job.pricing_method,
    activeOffers: job.activeOffers,
    retired: job.test_retired_at != null,
  });
  const action = customerCardAction({
    status: job.status,
    paymentStatus: job.payment_status,
    activeOffers: job.activeOffers,
  });

  return (
    <article className={`rounded-3xl bg-paper-raised p-3 ring-1 ring-line ${job.newOffers > 0 ? "ring-2 ring-brand" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-base font-semibold text-ink">{service.name}</p>
        <StatusPill status={job.status} />
      </div>
      <p className="mt-1 text-sm text-ink">
        {job.pickup_area}
        {job.dropoff_area ? ` → ${job.dropoff_area}` : ""}
      </p>
      <p className="mt-1 text-sm font-semibold text-ink">{status}</p>
      {job.activeOffers > 0 && tab === "requests" ? (
        <p className="text-sm text-ink">{job.activeOffers} {job.activeOffers === 1 ? "offer" : "offers"}</p>
      ) : null}
      {driverName ? <p className="text-sm text-ink">Driver: {driverName}</p> : null}
      {job.price_cents != null ? <p className="text-sm font-semibold text-ink">Total {formatCents(job.price_cents)}</p> : null}
      {job.service_fee_cents != null && job.service_fee_cents > 0 ? (
        <p className="text-sm text-ink">Card processing fee {formatCents(job.service_fee_cents)}</p>
      ) : null}
      {tab === "history" ? (
        <p className="text-sm text-muted">{formatUsWhen(job.updated_at)}</p>
      ) : job.preferred_date && job.preferred_date !== "asap" && job.preferred_date !== "today" ? (
        <p className="text-sm text-muted">{formatUsDay(job.preferred_date)}</p>
      ) : null}
      <Link href={`/jobs/${job.id}`} className="mt-2 inline-flex min-h-12 items-center font-semibold text-brand">
        {action}
      </Link>
    </article>
  );
}
