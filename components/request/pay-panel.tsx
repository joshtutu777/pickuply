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
  const subtotal = driverPayCents + platformFeeCents;
  return (
    <section className="mx-auto mt-4 w-full max-w-xl px-4">
      <div className="grid gap-2 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">Payment</h2>
        <p>Driver subtotal {formatCents(subtotal)}</p>
        <p>Service fee {formatCents(serviceFeeCents)}</p>
        <p className="font-semibold">Total {formatCents(totalCents)}</p>
        {confirmed.has(paymentStatus ?? "") ? (
          <p>Payment confirmed. The driver can start.</p>
        ) : windowOpen ? (
          <>
            <p>{minutesLeft} minutes left to pay.</p>
            {paymentStatus === "failed" ? <p>The card was declined. You can try again.</p> : null}
            {returning ? <p>Stripe is confirming the card. This page updates when the hold is approved.</p> : null}
            <form action={startCheckout}>
              <input type="hidden" name="jobId" value={jobId} />
              <button
                type="submit"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
              >
                Pay to confirm
              </button>
            </form>
          </>
        ) : (
          <p>The payment window has closed.</p>
        )}
      </div>
    </section>
  );
}
