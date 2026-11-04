"use client";

import { useState } from "react";
import { beginPayoutSetup } from "@/app/driver/connect/actions";
import { isNextRedirect, stripeOnboardingUrl } from "@/lib/payments/payout-setup-result";

export function PayoutSetupButton({
  label,
  className,
  formClassName = "mt-4",
}: {
  label: string;
  className: string;
  formClassName?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const result = await beginPayoutSetup();
      if (!result.ok) {
        setError(result.error);
        setPending(false);
        return;
      }
      const url = stripeOnboardingUrl(result.url);
      if (!url) {
        setError("Stripe did not open payout setup. Try again in a moment.");
        setPending(false);
        return;
      }
      window.location.assign(url);
    } catch (caught) {
      if (isNextRedirect(caught)) return;
      setError("Payout setup could not be started. Try again in a moment.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={formClassName}>
      <button type="submit" disabled={pending} aria-busy={pending} className={className}>
        {pending ? "Opening Stripe..." : label}
      </button>
      {error ? (
        <p role="alert" className="mt-3 text-base text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
