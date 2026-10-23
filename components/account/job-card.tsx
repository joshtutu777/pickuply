import Link from "next/link";
import { DottedStepper } from "@/components/mobile/dotted-stepper";
import { StatusPill } from "@/components/mobile/status-pill";
import { serviceById, type ServiceId } from "@/lib/constants";
import type { JobSummary } from "@/lib/data/job-queries";
import { customerNextAction, shortJobId } from "@/lib/jobs/next-action";
import { buildJobTracker } from "@/lib/jobs/tracker";

export function CustomerJobCard({
  job,
  featured = false,
}: {
  job: JobSummary;
  featured?: boolean;
}) {
  const service = serviceById(job.service as ServiceId);
  const action = customerNextAction({
    status: job.status,
    paymentStatus: job.payment_status,
    pricingMethod: job.pricing_method,
  });
  const tracker = buildJobTracker({
    service: job.service,
    status: job.status,
    pricingMethod: job.pricing_method,
    paymentStatus: job.payment_status,
    createdAt: job.created_at,
    dumpFeeCents: job.dump_fee_cents,
    hasDumpReceipt: false,
    events: [{ type: "status", createdAt: job.updated_at, toStatus: job.status }],
  });

  return (
    <article className={`rounded-3xl bg-paper-raised p-4 ring-1 ring-line ${featured ? "shadow-sm" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <StatusPill status={job.status} />
        <p className="text-sm font-semibold text-muted">#{shortJobId(job.id)}</p>
      </div>
      {featured ? (
        <div className="mt-4" aria-hidden="true">
          <div className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-full bg-ink" />
            <span className="h-0 flex-1 border-t-2 border-dashed border-brand" />
            <span className="size-3 shrink-0 rounded-full bg-brand" />
          </div>
          <p className="mt-2 text-sm font-semibold text-ink">
            {job.pickup_area}
            {job.dropoff_area ? ` → ${job.dropoff_area}` : ""}
          </p>
        </div>
      ) : null}
      <Link href={`/jobs/${job.id}`} className="mt-3 block min-h-12">
        <p className="text-lg font-semibold text-ink">{service.name}</p>
        {job.description ? <p className="mt-1 text-base text-ink">{job.description}</p> : null}
        {featured ? null : (
          <p className="mt-1 text-sm text-muted">
            {job.pickup_area}
            {job.dropoff_area ? ` → ${job.dropoff_area}` : ""}
          </p>
        )}
        <p className="mt-3 inline-flex min-h-12 items-center font-semibold text-brand">{action.label}</p>
      </Link>
      <div className="mt-3">
        <DottedStepper steps={tracker.steps} />
      </div>
    </article>
  );
}
