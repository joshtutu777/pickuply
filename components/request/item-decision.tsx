import { confirmDelivery, decidePickup } from "@/app/jobs/actions";
import { DropoffProof, PickupProof } from "@/components/request/proof-gallery";
import { ReportToggle } from "@/components/request/report-toggle";

export function ItemDecision({
  jobId,
  embedded = false,
}: {
  jobId: string;
  reviewUntil?: string | null;
  embedded?: boolean;
}) {
  const card = (
      <div className="grid gap-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">Wrong item?</h2>
        <p>The driver can keep going. Reject the item only if it is not the one you asked for.</p>
        <form action={decidePickup} className="grid gap-2">
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="decision" value="reject" />
          <label className="text-base font-semibold text-ink" htmlFor="reject-reason">
            Reason for rejecting the item
            <textarea
              id="reject-reason"
              name="reason"
              required
              minLength={3}
              maxLength={500}
              className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-paper px-4 py-3"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-paper px-6 font-semibold text-ink ring-1 ring-line"
          >
            Reject item
          </button>
        </form>
      </div>
  );
  if (embedded) return <div className="mt-3">{card}</div>;
  return <section className="mx-auto mt-4 w-full max-w-xl px-4">{card}</section>;
}

export function DropoffReview({
  jobId,
  confirmed,
  service = "delivery",
}: {
  jobId: string;
  confirmed: boolean;
  service?: string;
}) {
  const junk = service === "junk";
  return (
    <section className="mt-3 grid gap-3 rounded-3xl bg-brand-soft p-4 ring-2 ring-brand" aria-label="Does everything look good?">
      <h2 className="text-xl font-semibold text-ink">Does everything look good?</h2>
      <p>
        {junk
          ? "Look at the photo of the area after the junk was removed. Confirm, or report an issue."
          : "Look at the drop-off photo. Confirm, or report an issue."}
      </p>
      {junk ? <PickupProof jobId={jobId} alt="Completion photo" /> : <DropoffProof jobId={jobId} />}
      {confirmed ? (
        <p className="text-lg font-semibold text-ink">Thanks. Pickuply is finishing this job.</p>
      ) : (
        <>
          <form action={confirmDelivery}>
            <input type="hidden" name="jobId" value={jobId} />
            <button
              type="submit"
              className="inline-flex min-h-14 w-full items-center justify-center rounded-full bg-brand px-6 text-lg font-semibold text-white"
            >
              Confirm
            </button>
          </form>
          <ReportToggle jobId={jobId} />
        </>
      )}
      <p className="text-base text-ink">
        {junk
          ? "If you do not respond, this finishes 24 hours after the junk was removed."
          : "If you do not respond, this finishes 24 hours after delivery."}
      </p>
    </section>
  );
}
