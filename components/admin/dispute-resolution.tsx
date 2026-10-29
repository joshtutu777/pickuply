import { resolveDispute } from "@/app/admin/requests/dispute-actions";
import { damagePolicyCopy } from "@/lib/legal/damage-policy";

export function DisputeResolution({ jobId }: { jobId: string }) {
  return (
    <form action={resolveDispute} className="mt-6 grid gap-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <h2 className="text-lg font-semibold text-ink">Resolve the problem report</h2>
      <p className="text-base text-muted">
        {damagePolicyCopy} A refund outcome refunds the card through Stripe, then records the decision. A transfer that already moved is not reversed from here.
      </p>
      <input type="hidden" name="jobId" value={jobId} />
      <label className="text-base font-semibold" htmlFor="dispute-outcome">
        Outcome
        <select id="dispute-outcome" name="outcome" className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4">
          <option value="no_action">No action</option>
          <option value="partial_refund">Partial refund</option>
          <option value="full_refund">Full refund</option>
          <option value="payout_adjustment">Payout adjustment</option>
          <option value="driver_warning">Driver warning</option>
          <option value="driver_pause">Driver pause</option>
        </select>
      </label>
      <label className="text-base font-semibold" htmlFor="dispute-notes">
        Notes
        <textarea id="dispute-notes" name="notes" required rows={3} className="mt-2 w-full rounded-2xl border border-line px-4 py-3 font-normal" />
      </label>
      <label className="text-base font-semibold" htmlFor="dispute-amount">
        Amount in dollars, when money is part of the decision
        <input id="dispute-amount" name="amount" inputMode="decimal" className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4" />
      </label>
      <label className="text-base font-semibold" htmlFor="dispute-reason">
        Reason
        <input id="dispute-reason" name="reason" className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4" />
      </label>
      <label className="flex min-h-12 items-center gap-3 text-base">
        <input type="checkbox" name="releaseCapture" />
        Allow capture again
      </label>
      <label className="flex min-h-12 items-center gap-3 text-base">
        <input type="checkbox" name="releasePayout" />
        Allow the driver payout
      </label>
      <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white">
        Save resolution
      </button>
    </form>
  );
}
