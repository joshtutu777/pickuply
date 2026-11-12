"use client";

import { useState } from "react";
import { removeFromMarketplace } from "@/app/admin/requests/actions";
import { marketplaceRemovalMessage } from "@/lib/admin/marketplace-removal";

export function RemoveFromMarketplace({
  jobId,
  label,
  reason,
}: {
  jobId: string;
  label: string;
  reason: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const eligible = reason === "ready";

  return (
    <section className="mt-8 rounded-3xl border border-danger/40 bg-paper p-4">
      <h2 className="font-display text-2xl font-semibold text-ink">Remove from Marketplace</h2>
      {eligible ? (
        <p className="mt-2 text-base text-ink">
          This takes the request off the driver list and closes open offers. The request and its history stay. A driver, a card hold, a charge, a refund, or a dispute blocks this.
        </p>
      ) : (
        <p className="mt-2 text-base text-ink">{marketplaceRemovalMessage(reason)}</p>
      )}
      {eligible ? (
        <button
          type="button"
          className="mt-4 inline-flex min-h-12 items-center justify-center rounded-full bg-danger px-5 font-semibold text-white disabled:opacity-60"
          onClick={() => setOpen(true)}
          disabled={pending}
        >
          Remove from Marketplace
        </button>
      ) : null}
      {open && eligible ? (
        <div role="dialog" aria-modal="true" aria-labelledby="remove-marketplace-title" className="mt-4 rounded-2xl bg-paper-raised p-4 ring-1 ring-line">
          <h3 id="remove-marketplace-title" className="text-lg font-semibold text-ink">
            Remove {label} from the marketplace?
          </h3>
          <p className="mt-2 text-base text-ink">
            Drivers will no longer see this request. Open offers are closed. The request record stays, and this does not refund a card.
          </p>
          <form
            action={removeFromMarketplace}
            className="mt-4 flex flex-wrap gap-2"
            onSubmit={(event) => {
              if (pending) {
                event.preventDefault();
                return;
              }
              setPending(true);
            }}
          >
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="returnTo" value={`/admin/requests/${jobId}`} />
            <input type="hidden" name="confirm" value="yes" />
            <button
              type="button"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-paper px-5 font-semibold text-ink"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-danger px-5 font-semibold text-white disabled:opacity-60"
              disabled={pending}
            >
              {pending ? "Removing…" : "Remove request"}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
