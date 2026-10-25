import { confirmDelivery, decidePickup } from "@/app/jobs/actions";

export function ItemDecision({ jobId }: { jobId: string }) {
  return (
    <section className="mx-auto mt-4 w-full max-w-xl px-4">
      <div className="grid gap-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">Item check</h2>
        <p>Approve the item after you look at the pickup photo, or reject it with a reason.</p>
        <form action={decidePickup}>
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="decision" value="approve" />
          <button
            type="submit"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
          >
            Approve item
          </button>
        </form>
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
    </section>
  );
}

export function ConfirmDelivery({ jobId, confirmed }: { jobId: string; confirmed: boolean }) {
  return (
    <section className="mx-auto mt-4 w-full max-w-xl px-4">
      <div className="grid gap-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">Delivery</h2>
        {confirmed ? (
          <p>You confirmed this delivery.</p>
        ) : (
          <form action={confirmDelivery}>
            <input type="hidden" name="jobId" value={jobId} />
            <button
              type="submit"
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
            >
              Got it
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
