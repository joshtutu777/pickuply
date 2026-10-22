import Link from "next/link";
import { JobTrackerView } from "@/components/request/job-tracker";
import { serviceById, type ServiceId } from "@/lib/constants";
import type { JobSummary } from "@/lib/data/job-queries";
import { buildJobTracker } from "@/lib/jobs/tracker";
import { statusLabel } from "./job-status";

export function JobList({
  jobs,
  emptyTitle,
  emptyCopy,
  showPricing = false,
  showTracker = false,
  actionHref = "/request",
  hrefFor,
}: {
  jobs: JobSummary[];
  emptyTitle: string;
  emptyCopy: string;
  showPricing?: boolean;
  showTracker?: boolean;
  actionHref?: string | null;
  hrefFor?: (id: string) => string;
}) {
  if (jobs.length === 0) {
    return (
      <div className="mt-8 rounded-3xl bg-paper-raised p-5 ring-1 ring-line">
        <h2 className="text-xl font-semibold text-ink">{emptyTitle}</h2>
        <p className="mt-2 text-base leading-relaxed text-muted">{emptyCopy}</p>
        {actionHref ? (
          <Link
            href={actionHref}
            className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
          >
            Get a price
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <ul className="mt-6 grid gap-3">
      {jobs.map((job) => {
        const service = serviceById(job.service as ServiceId);
        const body = (
          <>
            <p className="text-lg font-semibold text-ink">{service.name}</p>
            <p className="text-sm text-muted">{new Date(job.created_at).toLocaleString()}</p>
            <p className="mt-1 text-base text-ink">{statusLabel(job.status)}</p>
            {showPricing ? (
              <p className="text-sm text-muted">
                {job.pricing_method} · {job.pickup_area}
              </p>
            ) : null}
            {showTracker && job.status !== "completed" && job.status !== "cancelled" ? (
              <JobTrackerView
                compact
                tracker={buildJobTracker({
                  service: job.service,
                  status: job.status,
                  pricingMethod: job.pricing_method,
                  paymentStatus: job.payment_status,
                  createdAt: job.created_at,
                  dumpFeeCents: job.dump_fee_cents,
                  hasDumpReceipt: false,
                  events: [{ type: "status", createdAt: job.updated_at, toStatus: job.status }],
                })}
              />
            ) : null}
          </>
        );
        const href = hrefFor ? hrefFor(job.id) : showPricing ? null : `/jobs/${job.id}`;
        return (
          <li key={job.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
            {href ? (
              <Link href={href} className="block min-h-12">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
