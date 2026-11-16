import {
  jobStatusLabel,
  offerActivityLabel,
  offerKindLabel,
  offerStatusLabel,
  paymentStatusLabel,
  readableTime,
  splitOfferGroups,
  type OfferBucket,
  type OfferTally,
} from "@/lib/admin/ops";
import { formatCents } from "@/lib/money";

export type AdminOfferView = {
  id: string;
  driverName: string;
  kind: string;
  status: string;
  bucket: OfferBucket;
  offerAmountCents: number | null;
  customerTotalCents: number | null;
  driverAmountCents: number | null;
  createdAt: string;
  reason: string | null;
  expirationPassed: boolean;
  canChoose: boolean;
};

export function RequestOffers({
  offers,
  tally,
  now,
  failed,
  bookingStatus,
  paymentStatus,
}: {
  offers: AdminOfferView[];
  tally: OfferTally;
  now: number;
  failed: boolean;
  bookingStatus: string;
  paymentStatus: string | null;
}) {
  const groups = splitOfferGroups(offers);
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
          <p className="text-base text-muted">
            Booking {jobStatusLabel(bookingStatus)} · Payment {paymentStatusLabel(paymentStatus)}
          </p>
          {offers.length === 0 ? null : (
            <>
              <OfferGroup title="Active offers" offers={groups.active} now={now} />
              <OfferGroup title="Earlier offers" offers={groups.earlier} now={now} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function money(cents: number | null): string {
  return cents == null ? "Not recorded" : formatCents(cents);
}

function OfferGroup({ title, offers, now }: { title: string; offers: AdminOfferView[]; now: number }) {
  if (offers.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <ul className="mt-3 space-y-3">
        {offers.map((offer) => (
          <li key={offer.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
            <p className="text-lg font-semibold text-ink">{offer.driverName}</p>
            <p className="text-base text-ink">{offerKindLabel(offer.kind)}</p>
            <p className="text-base text-ink">Offer amount {money(offer.offerAmountCents)}</p>
            <p className="text-base text-ink">Customer total {money(offer.customerTotalCents)}</p>
            <p className="text-base text-muted">Driver earnings {money(offer.driverAmountCents)}</p>
            <p className="text-base font-semibold text-ink">Status {offerStatusLabel(offer.status)}</p>
            {offer.expirationPassed ? (
              <p className="text-base text-ink">Active status — expiration time passed</p>
            ) : null}
            {offer.canChoose ? <p className="text-base text-ink">Customer can choose this</p> : null}
            {offer.status === "chosen" ? <p className="text-base text-ink">Selected by the customer</p> : null}
            <p className="text-sm text-muted">Submitted {readableTime(offer.createdAt, now)}</p>
            {offer.reason ? <p className="text-base text-ink">Reason: {offer.reason}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
