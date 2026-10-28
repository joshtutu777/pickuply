"use client";

import { useEffect, useRef } from "react";
import { chooseOffer } from "@/app/jobs/offer-actions";
import { PendingButton } from "@/components/pending-button";
import { formatCents } from "@/lib/money";
import { formatOfferWhen } from "@/lib/time/pickup-schedule";
import { createClient } from "@/lib/supabase/client";

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
  viewed?: boolean;
  rating_avg?: number | null;
  review_count?: number | null;
  proposed_pickup_start?: string | null;
  proposed_pickup_end?: string | null;
};

export function OfferChoices({ jobId, offers }: { jobId: string; offers: OfferSummary[] }) {
  const listRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const seen = new Set<string>();
    const mark = (ids: string[]) => {
      const fresh = ids.filter((id) => id && !seen.has(id));
      for (const id of fresh) seen.add(id);
      if (fresh.length === 0) return;
      void Promise.resolve(createClient().rpc("mark_offers_viewed", { offer_ids: fresh }));
    };
    const onScreen = (node: HTMLElement) => {
      const box = node.getBoundingClientRect();
      return box.height > 0 && box.bottom > 0 && box.top < window.innerHeight;
    };
    const visibleIds = () =>
      [...list.querySelectorAll<HTMLElement>("[data-offer-id]")]
        .filter(onScreen)
        .map((card) => card.dataset.offerId ?? "");
    const check = () => mark(visibleIds());
    check();
    const observer = new IntersectionObserver(
      (entries) => {
        mark(
          entries
            .filter((entry) => entry.isIntersecting)
            .map((entry) => entry.target.getAttribute("data-offer-id") ?? ""),
        );
      },
      { threshold: 0.15 },
    );
    for (const card of list.querySelectorAll<HTMLElement>("[data-offer-id]")) observer.observe(card);
    window.addEventListener("scroll", check, true);
    window.addEventListener("resize", check);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", check, true);
      window.removeEventListener("resize", check);
    };
  }, [offers]);

  if (offers.length === 0) return null;
  return (
    <section ref={listRef} className="space-y-3">
      <h2 className="text-lg font-semibold text-ink">Offers</h2>
      <p className="text-base text-muted">Choosing one assigns that driver. Nothing is charged yet.</p>
      {offers.map((offer) => {
        const isNew = !offer.viewed;
        return (
          <article
            key={offer.offer_id}
            data-offer-id={offer.offer_id}
            className={`rounded-3xl bg-paper-raised p-4 ring-1 ${isNew ? "ring-2 ring-brand" : "ring-line"}`}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-lg font-semibold text-ink">
                {offer.driver_first_name} — {formatCents(offer.driver_earnings_cents + offer.platform_fee_cents)}
                {offer.proposed_pickup_start
                  ? ` — ${formatOfferWhen(offer.proposed_pickup_start, offer.proposed_pickup_end ?? null)}`
                  : ""}
              </p>
              {isNew ? <p className="text-sm font-semibold text-brand">New</p> : null}
            </div>
            <p>{driverReputation(offer)}</p>
            <p>{offer.vehicle_label || "Vehicle"}</p>
            <p>Offer {formatCents(offer.driver_earnings_cents + offer.platform_fee_cents)}</p>
            <p>Card processing fee {formatCents(offer.service_fee_cents)}</p>
            <p className="font-semibold">Total {formatCents(offer.customer_total_cents)}</p>
            {offer.outside_range ? <p>Outside your range</p> : null}
            {offer.reason ? <p>Reason: {offer.reason}</p> : null}
            <p>Expires {new Date(offer.expires_at).toLocaleString()}</p>
            <form action={chooseOffer} className="mt-3">
              <input type="hidden" name="jobId" value={jobId} />
              <input type="hidden" name="offerId" value={offer.offer_id} />
              <PendingButton
                idle={`Choose ${offer.driver_first_name || "this driver"}`}
                pendingLabel="Submitting..."
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white disabled:opacity-60"
              />
            </form>
          </article>
        );
      })}
    </section>
  );
}

function driverReputation(offer: OfferSummary): string {
  const trips = offer.jobs_completed ?? 0;
  const reviews = offer.review_count ?? 0;
  if (reviews > 0 && offer.rating_avg != null) {
    return `★ ${Number(offer.rating_avg).toFixed(1)} (${reviews} reviews) · ${trips} completed trips`;
  }
  if (trips === 0) return "New driver · No reviews yet";
  return `${trips} completed trips · No reviews yet`;
}
