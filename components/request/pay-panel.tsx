import { startCheckout } from "@/app/jobs/pay/actions";
import { PendingButton } from "@/components/pending-button";
import { formatCents } from "@/lib/money";

const confirmed = new Set(["authorized", "paid", "captured"]);

export function PayPanel({
  jobId,
  driverPayCents,
  platformFeeCents,
  serviceFeeCents,
  totalCents,
  paymentStatus,
  minutesLeft,
  windowOpen,
  returning,
}: {
  jobId: string;
  driverPayCents: number;
  platformFeeCents: number;
  serviceFeeCents: number;
  totalCents: number;
  paymentStatus: string | null;
  minutesLeft: number;
  windowOpen: boolean;
  returning: boolean;
}) {
  const offerCents = driverPayCents + platformFeeCents;
  const additionalCents = totalCents - offerCents - serviceFeeCents;
  const balanced = additionalCents >= 0 && offerCents + serviceFeeCents + additionalCents === totalCents;
  return (
    <section className="mt-3 w-full">
      <div className="grid min-w-0 gap-2 overflow-hidden rounded-3xl bg-paper-raised p-4 break-words ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">Confirm Your Booking</h2>
        {balanced ? (
          <>
            <p>{"Selected driver's offer "}{formatCents(offerCents)}</p>
            <p>Card processing fee {formatCents(serviceFeeCents)}</p>
            <p className="text-muted">This processing fee is added to the offer. Pickuply does not add another service fee.</p>
            <p>{additionalCents === 0 ? "No additional charges" : `Additional charges ${formatCents(additionalCents)}`}</p>
          </>
        ) : null}
        <p className="font-semibold">Total {formatCents(totalCents)}</p>
        {confirmed.has(paymentStatus ?? "") ? (
          <p>Booking confirmed. {formatCents(totalCents)} is held on your card and charged only after delivery.</p>
        ) : windowOpen ? (
          <>
            <p>{minutesLeft} minutes left to pay.</p>
            {paymentStatus === "failed" ? <p>The card was declined. You can try again.</p> : null}
            {returning ? <p>Stripe is confirming the card. This page updates when the hold is approved.</p> : null}
            <p>
              Confirm your booking. Your card will be authorized now and charged after delivery is completed under
              Pickuply&apos;s payment policy.
            </p>
            <form action={startCheckout}>
              <input type="hidden" name="jobId" value={jobId} />
              <PendingButton
                idle="Confirm booking"
                pendingLabel="Submitting..."
                className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-6 text-center font-semibold text-white disabled:opacity-60 sm:w-auto"
              />
              <p className="mt-2 text-base text-muted">You won&apos;t be charged until your item is delivered</p>
            </form>
          </>
        ) : (
          <p>The payment window has closed.</p>
        )}
      </div>
    </section>
  );
}
