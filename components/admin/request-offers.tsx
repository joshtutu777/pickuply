import { offerActivityLabel, offerKindLabel, offerStateLabel, readableTime, type OfferBucket, type OfferTally } from "@/lib/admin/ops";
import { formatCents } from "@/lib/money";

export type AdminOfferView = {
  id: string;
  driverName: string;
  kind: string;
  status: string;
  bucket: OfferBucket;
  customerTotalCents: number;
  driverAmountCents: number;
  createdAt: string;
  reason: string | null;
};

export function RequestOffers({
  offers,
  tally,
  now,
  failed,
}: {
  offers: AdminOfferView[];
  tally: OfferTally;
  now: number;
  failed: boolean;
}) {
  return (
    <section className="mt-6" aria-labelledby="request-offers-heading">
      <h2 id="request-offers-heading" className="text-lg font-semibold text-ink">
        Offers
      </h2>
      {failed ? (
        <p role="alert" className="mt-2 text-base text-danger">
          Offers could not be loaded. Refresh and try again.
        </p>
      ) : (
        <>
          <p className="mt-2 text-base text-ink">{offerActivityLabel(tally)}</p>
          {offers.length === 0 ? null : (
            <ul className="mt-3 space-y-3">
              {offers.map((offer) => (
                <li key={offer.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
                  <p className="text-lg font-semibold text-ink">{offer.driverName}</p>
                  <p className="text-base text-ink">{offerKindLabel(offer.kind)}</p>
                  <p className="text-base text-ink">Customer total {formatCents(offer.customerTotalCents)}</p>
                  <p className="text-base text-muted">Driver earnings {formatCents(offer.driverAmountCents)}</p>
                  <p className="text-base font-semibold text-ink">{offerStateLabel(offer.bucket, offer.status)}</p>
                  <p className="text-sm text-muted">Submitted {readableTime(offer.createdAt, now)}</p>
                  {offer.reason ? <p className="text-base text-ink">Reason: {offer.reason}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
