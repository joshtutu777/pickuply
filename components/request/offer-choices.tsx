import { chooseOffer } from "@/app/jobs/offer-actions";
import { formatCents } from "@/lib/money";

export type OfferSummary = {
  offer_id: string;
  driver_first_name: string;
  vehicle_label: string;
  jobs_completed: number;
  reason: string | null;
  outside_range: boolean;
  customer_total_cents: number;
  driver_earnings_cents: number;
  platform_fee_cents: number;
  service_fee_cents: number;
  expires_at: string;
};

export function OfferChoices({ jobId, offers }: { jobId: string; offers: OfferSummary[] }) {
  if (offers.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-xl space-y-3 px-4 pb-8">
      <h2 className="text-lg font-semibold text-ink">Offers</h2>
      <p className="text-base text-muted">Choosing one assigns that driver. Nothing is charged yet.</p>
      {offers.map((offer) => (
        <article key={offer.offer_id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
          <p className="text-lg font-semibold text-ink">{offer.driver_first_name}</p>
          <p>
            {offer.vehicle_label || "Vehicle"} · {offer.jobs_completed} jobs completed
          </p>
          <p>Subtotal {formatCents(offer.driver_earnings_cents + offer.platform_fee_cents)}</p>
          <p>Service fee {formatCents(offer.service_fee_cents)}</p>
          <p className="font-semibold">Total {formatCents(offer.customer_total_cents)}</p>
          {offer.outside_range ? <p>Outside your range</p> : null}
          {offer.reason ? <p>Reason: {offer.reason}</p> : null}
          <p>Expires {new Date(offer.expires_at).toLocaleString()}</p>
          <form action={chooseOffer} className="mt-3">
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="offerId" value={offer.offer_id} />
            <button
              type="submit"
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
            >
              Choose this driver
            </button>
          </form>
        </article>
      ))}
    </section>
  );
}
