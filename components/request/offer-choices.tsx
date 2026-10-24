"use client";

import { useEffect, useRef } from "react";
import { chooseOffer } from "@/app/jobs/offer-actions";
import { formatCents } from "@/lib/money";
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
    <section ref={listRef} className="mx-auto w-full max-w-xl space-y-3 px-4 pb-8">
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
              <p className="text-lg font-semibold text-ink">{offer.driver_first_name}</p>
              {isNew ? <p className="text-sm font-semibold text-brand">New</p> : null}
            </div>
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
        );
      })}
    </section>
  );
}
