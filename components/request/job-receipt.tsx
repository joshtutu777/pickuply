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
      <div className="grid gap-2 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">Receipt</h2>
        <p>Job {jobId}</p>
        <p>Date {when}</p>
        <p>Service {service}</p>
        <p>Driver {driverFirstName ?? "Assigned driver"}</p>
        <p>Driver subtotal {driverSubtotalCents == null ? "not set" : formatCents(driverSubtotalCents)}</p>
        <p>Service fee {serviceFeeCents == null ? "not set" : formatCents(serviceFeeCents)}</p>
        <p className="font-semibold">Total {totalCents == null ? "not set" : formatCents(totalCents)}</p>
        {tripFeeCents != null && tripFeeCents > 0 ? <p>Trip fee {formatCents(tripFeeCents)}</p> : null}
        <p>Refunds {formatCents(refundedCents)}</p>
        <p>Payment {paymentStatus?.replaceAll("_", " ") ?? "not started"}</p>
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
