import { cancelAssignedJob } from "@/app/jobs/actions";
import { formatCents } from "@/lib/money";

export function JobReceipt({
  jobId,
  service,
  when,
  driverFirstName,
  driverSubtotalCents,
  serviceFeeCents,
  totalCents,
  tripFeeCents,
  refundedCents,
  paymentStatus,
  canCancel,
}: {
  jobId: string;
  service: string;
  when: string;
  driverFirstName: string | null;
  driverSubtotalCents: number | null;
  serviceFeeCents: number | null;
  totalCents: number | null;
  tripFeeCents: number | null;
  refundedCents: number;
  paymentStatus: string | null;
  canCancel: boolean;
}) {
  return (
    <section className="mx-auto mt-4 w-full max-w-xl px-4">
      <div className="grid min-w-0 gap-2 overflow-hidden rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">Receipt</h2>
        <p className="break-all">Job {jobId}</p>
        <p className="break-words">Date {when}</p>
        <p className="break-words">Service {service}</p>
        <p className="break-words">Driver {driverFirstName ?? "Assigned driver"}</p>
        <p className="break-words">Offer {driverSubtotalCents == null ? "not set" : formatCents(driverSubtotalCents)}</p>
        <p className="break-words">Card processing fee {serviceFeeCents == null ? "not set" : formatCents(serviceFeeCents)}</p>
        <p className="break-words font-semibold">Total {totalCents == null ? "not set" : formatCents(totalCents)}</p>
        {tripFeeCents != null && tripFeeCents > 0 ? <p className="break-words">Trip fee {formatCents(tripFeeCents)}</p> : null}
        <p className="break-words">Refunds {formatCents(refundedCents)}</p>
        <p className="break-words">Payment {paymentStatus?.replaceAll("_", " ") ?? "not started"}</p>
        {canCancel ? (
          <form action={cancelAssignedJob}>
            <input type="hidden" name="jobId" value={jobId} />
            <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-danger">
              Cancel this job
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
