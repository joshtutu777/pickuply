"use client";

import { useState } from "react";
import { removeCustomer } from "@/app/admin/customers/actions";

export function RemoveCustomer({
  profileId,
  label,
}: {
  profileId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <section className="mt-8 rounded-3xl border border-danger/40 bg-paper p-4">
      <h2 className="font-display text-2xl font-semibold text-ink">Delete customer account</h2>
      <p className="mt-2 text-base text-ink">
        This is only for a customer with no requests, payments, refunds, or disputes. Those records are never deleted from here. A customer who has them can be suspended instead.
      </p>
      <button
        type="button"
        className="mt-4 inline-flex min-h-12 items-center justify-center rounded-full bg-danger px-5 font-semibold text-white disabled:opacity-60"
        onClick={() => setOpen(true)}
        disabled={pending}
      >
        Delete customer account
      </button>
      {open ? (
        <div role="dialog" aria-modal="true" aria-labelledby="remove-customer-title" className="mt-4 rounded-2xl bg-paper-raised p-4 ring-1 ring-line">
          <h3 id="remove-customer-title" className="text-lg font-semibold text-ink">
            Delete {label}?
          </h3>
          <p className="mt-2 text-base text-ink">
            The sign-in for this customer will stop working. The phone number can be used for a new account. This does not delete requests or payments, and it cannot be undone from this page.
          </p>
          <form
            action={removeCustomer}
            className="mt-4 flex flex-wrap gap-2"
            onSubmit={(event) => {
              if (pending) {
                event.preventDefault();
                return;
              }
              setPending(true);
            }}
          >
            <input type="hidden" name="profileId" value={profileId} />
            <input type="hidden" name="returnTo" value={`/admin/customers/${profileId}`} />
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
              {pending ? "Deleting…" : "Delete account"}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
