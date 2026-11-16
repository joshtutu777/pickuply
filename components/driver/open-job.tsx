"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { OfferForm } from "@/components/driver/offer-form";
import { junkLoadSizes } from "@/lib/constants";
import {
  fromYouLabel,
  hiddenUntilAssigned,
  itemPhotoLabel,
  jobTypeLabel,
  offerAmountCents,
  offerCardLine,
  pickupTimeLabel,
  placeLabel,
  structuredItemFacts,
  tripDistanceLabel,
  unavailableJobTitle,
  vehicleNeedLabel,
} from "@/lib/driver/feed-card";
import type { FeeSettings } from "@/lib/fees";
import { formatCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";

type OpenJobRow = {
  id: string;
  service: string;
  pieces: number;
  size: string;
  pickup_area: string;
  dropoff_area: string | null;
  distance_miles: number | null;
  stairs_pickup: number;
  stairs_dropoff: number | null;
  elevator: boolean;
  help_loading: boolean;
  preferred_date: string;
  time_window: string | null;
  pricing_method: string;
  offer_cents: number | null;
  budget_min_cents: number | null;
  budget_max_cents: number | null;
  driver_pay_cents: number | null;
  junk_load_size: string | null;
  service_level: string | null;
  required_vehicle: string | null;
  miles_from_you: number | null;
};

type OwnOffer = {
  id: string;
  status: string;
  kind: string;
  driver_amount_cents: number;
  platform_fee_cents: number;
  created_at: string;
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-base text-ink">
      <span className="text-muted">{label} </span>
      {value}
    </p>
  );
}

export function OpenJob({
  jobId,
  approved,
  isOnline,
  userId,
  vehicleType,
  fees,
}: {
  jobId: string;
  approved: boolean;
  isOnline: boolean;
  userId: string;
  vehicleType: string | null;
  fees: FeeSettings;
}) {
  const [online, setOnline] = useState(isOnline);
  const [job, setJob] = useState<OpenJobRow | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [offers, setOffers] = useState<OwnOffer[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");

  const load = useCallback(async () => {
    const supabase = createClient();
    const [feed, mine] = await Promise.all([
      supabase.rpc("driver_job_feed"),
      supabase
        .from("job_offers")
        .select("id, status, kind, driver_amount_cents, platform_fee_cents, created_at")
        .eq("job_id", jobId)
        .eq("driver_id", userId)
        .order("created_at", { ascending: false }),
    ]);
    if (mine.error) {
      setState("error");
      return;
    }
    setOffers((mine.data ?? []) as OwnOffer[]);
    if (feed.error) {
      setState("error");
      return;
    }
    const row = ((feed.data ?? []) as OpenJobRow[]).find((item) => item.id === jobId) ?? null;
    setJob(row);
    if (!row) {
      setPhotos([]);
      setState("unavailable");
      return;
    }
    const { data: photoRows } = await supabase
      .from("job_photos")
      .select("storage_path, stage")
      .eq("job_id", jobId)
      .eq("stage", "request");
    const urls: string[] = [];
    for (const photo of photoRows ?? []) {
      if (photo.stage !== "request") continue;
      const signed = await supabase.storage.from("job-photos").createSignedUrl(photo.storage_path, 300);
      if (signed.data?.signedUrl) urls.push(signed.data.signedUrl);
    }
    setPhotos(urls);
    setState("ready");
  }, [jobId, userId]);

  useEffect(() => {
    const start = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(start);
  }, [load]);

  async function goOnline(): Promise<{ online: boolean; error: string | null }> {
    const supabase = createClient();
    const { error } = await supabase.rpc("set_driver_online", { go_online: true });
    const confirmed = await supabase.from("drivers").select("is_online").eq("profile_id", userId).maybeSingle();
    const nowOnline = Boolean(confirmed.data?.is_online);
    setOnline(nowOnline);
    if (error || !nowOnline) return { online: false, error: error?.message ?? "You are still Offline." };
    return { online: true, error: null };
  }

  const vehicleOk = !job?.required_vehicle || job.required_vehicle === vehicleType;
  const blockedReason = !approved
    ? "Finish setup to accept jobs."
    : !vehicleOk
      ? "This job needs a different vehicle."
      : null;
  const loadName = job?.junk_load_size
    ? junkLoadSizes.find((item) => item.id === job.junk_load_size)?.label ?? job.junk_load_size
    : null;
  const item = job
    ? structuredItemFacts({
        service: job.service,
        pieces: job.pieces,
        size: job.size,
        helpLoading: job.help_loading,
        stairsPickup: job.stairs_pickup,
        stairsDropoff: job.stairs_dropoff,
        elevator: job.elevator,
      })
    : null;

  return (
    <main className="mx-auto w-full min-w-0 max-w-xl flex-1 overflow-x-clip px-4 py-4 pb-8">
      <Link href="/driver" className="inline-flex min-h-12 items-center text-base font-semibold text-brand">
        Back to jobs
      </Link>
      {state === "loading" ? <p className="mt-4 text-base text-muted">Loading this request…</p> : null}
      {state === "error" ? (
        <p role="alert" className="mt-4 text-base text-danger">
          We couldn&apos;t load this request.{" "}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Try again
          </button>
        </p>
      ) : null}
      {state === "unavailable" ? (
        <section className="mt-4 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
          <h1 className="text-xl font-semibold text-ink">{unavailableJobTitle}</h1>
          <p className="mt-2 text-base text-ink">
            It is not in your open jobs. It may already be booked, or it may no longer match what you can take.
          </p>
        </section>
      ) : null}
      {offers.length > 0 ? (
        <section className="mt-4 rounded-3xl bg-paper-raised p-4 ring-1 ring-line" aria-label="Your offers">
          <h2 className="text-lg font-semibold text-ink">Your offers</h2>
          <ul className="mt-3 grid gap-3">
            {offers.map((offer) => (
              <li key={offer.id} className="text-base text-ink">
                <p className="font-semibold">
                  {offerCardLine(offer.status, offerAmountCents(offer.driver_amount_cents, offer.platform_fee_cents)) ?? offer.status}
                </p>
                <p>Job Amount: {formatCents(offerAmountCents(offer.driver_amount_cents, offer.platform_fee_cents))}</p>
                <p>Your Estimated Earnings: {formatCents(offer.driver_amount_cents)}</p>
                <p className="text-muted">{new Date(offer.created_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {state === "ready" && job ? (
        <>
          <section className="mt-4 grid gap-2 rounded-3xl bg-paper-raised p-4 ring-1 ring-line" aria-label="Job details">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-xl font-semibold text-ink">{jobTypeLabel(job.service)}</h1>
              <p className="shrink-0 rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand">Available</p>
            </div>
            <h2 className="text-base font-semibold text-ink">Item</h2>
            <Fact label="Type" value={item?.type ?? ""} />
            <Fact label="Quantity" value={item?.quantity ?? ""} />
            <Fact label="Approximate size" value={item?.size ?? ""} />
            <Fact label="Special handling" value={item?.handling ?? ""} />
            {loadName ? <Fact label="Load" value={loadName} /> : null}
            <p className="text-base text-ink">
              Measurements in inches are not collected. The customer&apos;s written description stays hidden until you are assigned.
            </p>
            {photos.length > 0 ? (
              <ul className="grid grid-cols-3 gap-2">
                {photos.map((url) => (
                  <li key={url} className="min-w-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="Item photo" className="aspect-square w-full rounded-2xl object-cover" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-base text-muted">{itemPhotoLabel(0)}</p>
            )}
            <h2 className="text-base font-semibold text-ink">Pickup and drop-off</h2>
            <Fact label="Pickup" value={placeLabel(job.pickup_area, "pickup")} />
            <Fact label="Drop-off" value={placeLabel(job.dropoff_area, "dropoff")} />
            <h2 className="text-base font-semibold text-ink">Customer instructions</h2>
            <p className="text-base text-ink">{hiddenUntilAssigned}</p>
            <p className="text-base text-ink">{tripDistanceLabel(job.distance_miles == null ? null : Number(job.distance_miles))}</p>
            <p className="text-base text-ink">{fromYouLabel(job.miles_from_you == null ? null : Number(job.miles_from_you))}</p>
            <Fact label="Vehicle" value={vehicleNeedLabel(job.required_vehicle)} />
            {job.service_level ? <Fact label="Service level" value={job.service_level.replaceAll("_", " ")} /> : null}
            <Fact label="Pickup time" value={pickupTimeLabel(job.preferred_date, job.time_window)} />
            {job.pricing_method === "fixed" && job.offer_cents != null ? (
              <p className="text-base text-ink">Job Amount: {formatCents(job.offer_cents)}</p>
            ) : null}
            {job.pricing_method === "range" && job.budget_min_cents != null && job.budget_max_cents != null ? (
              <p className="text-base text-ink">
                Budget {formatCents(job.budget_min_cents)}–{formatCents(job.budget_max_cents)}
              </p>
            ) : null}
            {job.driver_pay_cents != null ? (
              <p className="text-base font-semibold text-ink">Your Estimated Earnings: {formatCents(job.driver_pay_cents)}</p>
            ) : null}
          </section>
          <section aria-label="Your offer" className="mt-4 scroll-mb-8 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
            <h2 className="text-lg font-semibold text-ink">Your offer</h2>
            <div className="mt-3">
              <OfferForm
                job={job}
                approved={approved}
                online={online}
                vehicleOk={vehicleOk}
                blockedReason={blockedReason}
                fees={fees}
                onDone={() => void load()}
                onGoOnline={goOnline}
              />
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
