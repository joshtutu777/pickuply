import { startCheckout } from "@/app/jobs/pay/actions";
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
    <section className="mx-auto mt-4 w-full max-w-xl px-4">
      <div className="grid gap-2 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
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
              Your card will be authorized when you confirm your booking. Payment is charged after you confirm the
              delivery, or 24 hours later if you do not. If the authorization expires first, the card is not charged.
            </p>
            <form action={startCheckout}>
              <input type="hidden" name="jobId" value={jobId} />
              <button
                type="submit"
                className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-6 text-center font-semibold text-white sm:w-auto"
              >
                Confirm booking
              </button>
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
