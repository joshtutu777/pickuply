"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { recordFunnel } from "@/lib/funnel";
import { createClient } from "@/lib/supabase/client";

type FeedJob = {
  id: string;
  service: string;
  pieces: number;
  size: string;
  pickup_area: string;
  dropoff_area: string | null;
  distance_miles: number | null;
  stairs_pickup: number;
  stairs_dropoff: number | null;
  preferred_date: string;
  time_window: string | null;
  pricing_method: string;
  offer_cents: number | null;
  budget_min_cents: number | null;
  budget_max_cents: number | null;
  driver_pay_cents: number | null;
  required_vehicle: string | null;
  service_level: string | null;
};

type FeedCard = FeedJob & { photos: string[]; earningsCents: number | null };

function OfferActions({
  job,
  online,
  onDone,
}: {
  job: FeedCard;
  online: boolean;
  onDone: () => void;
}) {
  const [earnings, setEarnings] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ cents: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  const earningsCents = parseDollarsToCents(earnings) ?? 0;
  const previewTotal = preview && preview.cents === earningsCents ? preview.total : null;

  useEffect(() => {
    if (job.pricing_method === "quote" || earningsCents <= 0) return;
    let cancelled = false;
    void createClient()
      .rpc("price_breakdown", { mode: "forward", amount_cents: earningsCents })
      .then(({ data }) => {
        const total = (data as { customer_total_cents?: number } | null)?.customer_total_cents;
        if (!cancelled && total != null) setPreview({ cents: earningsCents, total });
      });
    return () => {
      cancelled = true;
    };
  }, [earningsCents, job.pricing_method]);

  async function send(kind: "accept" | "counter" | "claim") {
    setMessage(null);
    const supabase = createClient();
    const result =
      kind === "claim"
        ? await supabase.rpc("claim_job", { target_job: job.id })
        : await supabase.rpc("submit_offer", {
            target_job: job.id,
            kind,
            earnings_cents: kind === "accept" ? null : earningsCents,
            reason,
          });
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    setMessage(kind === "claim" ? "You are assigned. Payment is still due." : "Offer sent. The customer chooses.");
    if (kind === "claim" || kind === "accept") {
      void recordFunnel({ event: "driver_claim", step: kind, service: job.service, pricing: job.pricing_method });
    }
    if (kind === "claim") router.refresh();
    onDone();
  }

  return (
    <div className="mt-3 grid gap-3">
      {job.pricing_method === "quote" ? (
        <button
          type="button"
          disabled={!online}
          onClick={() => void send("claim")}
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand font-semibold text-white disabled:opacity-60"
        >
          Claim this job
        </button>
      ) : null}
      {job.pricing_method === "fixed" ? (
        <button
          type="button"
          disabled={!online}
          onClick={() => void send("accept")}
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand font-semibold text-white disabled:opacity-60"
        >
          Accept posted price
        </button>
      ) : null}
      {job.pricing_method !== "quote" ? (
        <>
          <label className="text-base font-semibold text-ink">
            Your earnings (dollars)
            <input
              value={earnings}
              onChange={(event) => setEarnings(event.target.value)}
              inputMode="decimal"
              className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4"
            />
          </label>
          {previewTotal != null ? <p>Customer total {formatCents(previewTotal)}</p> : null}
          <label className="text-base font-semibold text-ink">
            Reason if this is a counter
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4"
            />
          </label>
          <button
            type="button"
            disabled={!online}
            onClick={() => void send("counter")}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink font-semibold text-white disabled:opacity-60"
          >
            {job.pricing_method === "range" ? "Send offer or counter" : "Send counter"}
          </button>
        </>
      ) : null}
      {message ? <p className="text-base text-ink">{message}</p> : null}
    </div>
  );
}

export function DriverHome({
  isOnline,
  missing,
}: {
  isOnline: boolean;
  missing: string[];
}) {
  const [online, setOnline] = useState(isOnline);
  const [jobs, setJobs] = useState<FeedCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error: feedError } = await supabase.rpc("driver_job_feed");
    if (feedError) {
      setError("We couldn't load jobs.");
      return;
    }
    const rows = (data ?? []) as FeedJob[];
    const ids = rows.map((job) => job.id);
    const photos = new Map<string, string[]>();
    if (ids.length > 0) {
      const { data: photoRows } = await supabase
        .from("job_photos")
        .select("job_id, storage_path, stage")
        .in("job_id", ids)
        .eq("stage", "request");
      for (const photo of photoRows ?? []) {
        if (photo.stage !== "request") continue;
        const signed = await supabase.storage.from("job-photos").createSignedUrl(photo.storage_path, 300);
        if (!signed.data?.signedUrl) continue;
        photos.set(photo.job_id, [...(photos.get(photo.job_id) ?? []), signed.data.signedUrl]);
      }
    }
    const cards: FeedCard[] = [];
    for (const job of rows) {
      let earnings: number | null = job.driver_pay_cents;
      if (job.pricing_method === "fixed" && job.offer_cents) {
        const priced = await supabase.rpc("price_breakdown", {
          mode: "accept",
          amount_cents: job.offer_cents,
        });
        const body = priced.data as { driver_earnings_cents?: number } | null;
        earnings = body?.driver_earnings_cents ?? null;
      }
      cards.push({ ...job, photos: photos.get(job.id) ?? [], earningsCents: earnings });
    }
    setJobs(cards);
    setError(null);
  }, []);

  useEffect(() => {
    const start = window.setTimeout(() => {
      void load();
    }, 0);
    const timer = window.setInterval(() => {
      void load();
    }, 25000);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, [load]);

  async function toggleOnline() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: onlineError } = await supabase.rpc("set_driver_online", { go_online: !online });
    setBusy(false);
    if (onlineError) {
      setError(onlineError.message);
      return;
    }
    if (!online) void recordFunnel({ event: "driver_online", step: "online" });
    setOnline(!online);
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggleOnline()}
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white disabled:opacity-60"
      >
        {online ? "You are Online" : "You are Offline"}
      </button>
      {missing.length > 0 ? (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-base text-ink">
          {missing.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-base text-danger">
          {error}
        </p>
      ) : null}
      <p className="mt-4 text-base text-muted">
        You can browse while Offline. Claiming or offering requires Online.
      </p>
      {jobs.length === 0 ? (
        <p className="mt-6 text-base text-muted">No open jobs match your vehicle and area right now.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {jobs.map((job) => (
            <li key={job.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
              <p className="text-lg font-semibold text-ink">{job.service.replaceAll("_", " ")}</p>
              <p className="mt-1 text-base">
                {job.pickup_area}
                {job.dropoff_area ? ` to ${job.dropoff_area}` : ""}
                {job.distance_miles != null ? ` · ${job.distance_miles} mi` : ""}
              </p>
              <p>
                {job.pieces} pieces · {job.size} · {job.required_vehicle} · {job.service_level}
              </p>
              <p>
                Stairs {job.stairs_pickup}
                {job.stairs_dropoff != null ? ` / ${job.stairs_dropoff}` : ""} · {job.preferred_date}
                {job.time_window ? ` · ${job.time_window}` : ""}
              </p>
              {job.pricing_method === "fixed" && job.offer_cents != null ? (
                <p>Customer posted {formatCents(job.offer_cents)}</p>
              ) : null}
              {job.pricing_method === "range" && job.budget_min_cents != null && job.budget_max_cents != null ? (
                <p>
                  Budget {formatCents(job.budget_min_cents)}–{formatCents(job.budget_max_cents)}
                </p>
              ) : null}
              {job.earningsCents != null ? (
                <p className="font-semibold">Your earnings {formatCents(job.earningsCents)}</p>
              ) : (
                <p>Enter your earnings when you offer.</p>
              )}
              <OfferActions job={job} online={online} onDone={() => void load()} />
              {job.photos.length > 0 ? (
                <ul className="mt-3 grid grid-cols-3 gap-2">
                  {job.photos.map((url) => (
                    <li key={url}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="aspect-square w-full rounded-2xl object-cover" />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
