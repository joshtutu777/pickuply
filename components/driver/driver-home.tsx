"use client";

import { useCallback, useEffect, useState } from "react";
import { dismissOnlinePrompt } from "@/app/driver/actions";
import { useRouter } from "next/navigation";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { recordFunnel } from "@/lib/funnel";
import { CoverageEditor } from "@/components/driver/coverage-editor";
import { FeedMap } from "@/components/maps/feed-map";
import { coverageSummary, type CoverageDraft } from "@/lib/driver/coverage";
import { takenJobMessage } from "@/lib/jobs/taken-message";
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
  elevator: boolean;
  help_loading: boolean;
  preferred_date: string;
  time_window: string | null;
  pricing_method: string;
  offer_cents: number | null;
  budget_min_cents: number | null;
  budget_max_cents: number | null;
  driver_pay_cents: number | null;
  required_vehicle: string | null;
  service_level: string | null;
  miles_from_you: number | null;
};

type FeedCard = FeedJob & { photos: string[]; earningsCents: number | null };

function OfferActions({
  job,
  canAct,
  blockedReason,
  onDone,
}: {
  job: FeedCard;
  canAct: boolean;
  blockedReason: string | null;
  onDone: () => void;
}) {
  const [earnings, setEarnings] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ cents: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ text: string; alert: boolean } | null>(null);
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
      setMessage({ text: takenJobMessage(result.error.message), alert: true });
      return;
    }
    setMessage({
      text: kind === "claim" ? "You are assigned. Payment is still due." : "Offer sent. The customer chooses.",
      alert: false,
    });
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
          disabled={!canAct}
          onClick={() => void send("claim")}
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand font-semibold text-white disabled:opacity-60"
        >
          Claim this job
        </button>
      ) : null}
      {job.pricing_method === "fixed" ? (
        <button
          type="button"
          disabled={!canAct}
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
            disabled={!canAct}
            onClick={() => void send("counter")}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink font-semibold text-white disabled:opacity-60"
          >
            {job.pricing_method === "range" ? "Send offer or counter" : "Send counter"}
          </button>
        </>
      ) : null}
      {blockedReason ? <p className="text-base text-ink">{blockedReason}</p> : null}
      {message ? (
        <p role={message.alert ? "alert" : "status"} className={message.alert ? "text-base text-danger" : "text-base text-ink"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

export function DriverHome({
  isOnline,
  userId,
  showFeed,
  approved,
  vehicleType,
  everOnline,
  promptDismissed,
  coverage,
  showAllJobs,
  feedServices,
  vehicleFit,
}: {
  isOnline: boolean;
  userId: string;
  showFeed: boolean;
  approved: boolean;
  vehicleType: string | null;
  everOnline: boolean;
  promptDismissed: boolean;
  coverage: CoverageDraft;
  showAllJobs: boolean;
  feedServices: string;
  vehicleFit: boolean;
}) {
  const [online, setOnline] = useState(isOnline);
  const [jobs, setJobs] = useState<FeedCard[]>([]);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [areas, setAreas] = useState(coverage);
  const [showAll, setShowAll] = useState(showAllJobs);
  const [editingAreas, setEditingAreas] = useState(false);
  const [filterServices, setFilterServices] = useState(feedServices);
  const [filterFit, setFilterFit] = useState(vehicleFit);
  const [filterNote, setFilterNote] = useState<string | null>(null);
  const [mapView, setMapView] = useState(false);
  const summary = coverageSummary({ cities: areas.cities, zips: areas.zips, radiusMiles: areas.radius });

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error: feedError } = await supabase.rpc("driver_job_feed");
    if (feedError) {
      setFeedError("We couldn't load jobs.");
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
    setFeedError(null);
  }, []);

  useEffect(() => {
    if (!showFeed) return;
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
  }, [load, showFeed]);

  async function toggleOnline() {
    setBusy(true);
    setSwitchError(null);
    const supabase = createClient();
    const goingOnline = !online;
    const { error: onlineError } = await supabase.rpc("set_driver_online", { go_online: goingOnline });
    const confirmed = await supabase.from("drivers").select("is_online").eq("profile_id", userId).maybeSingle();
    const nowOnline = Boolean(confirmed.data?.is_online);
    setBusy(false);
    setOnline(nowOnline);
    if (onlineError || (goingOnline && !nowOnline)) {
      setSwitchError(onlineError?.message ?? "You are still Offline.");
      return;
    }
    if (goingOnline && nowOnline) void recordFunnel({ event: "driver_online", step: "online" });
  }

  async function saveOptions(services: string, fit: boolean) {
    const supabase = createClient();
    const result = await supabase.rpc("save_driver_feed_options", {
      service_names: services.split(",").map((item) => item.trim()).filter(Boolean),
      fit_vehicle: fit,
    });
    setFilterNote(result.error ? result.error.message : "Saved");
    void load();
  }

  async function toggleShowAll() {
    const next = !showAll;
    const { error } = await createClient().rpc("set_show_all_jobs", { enabled: next });
    if (error) {
      setFilterNote(error.message);
      return;
    }
    setShowAll(next);
    void load();
  }

  return (
    <>
    <section aria-label="Availability">
      <button
        type="button"
        role="switch"
        aria-checked={online}
        aria-label={online ? "You are Online" : "You are Offline"}
        disabled={busy}
        onClick={() => void toggleOnline()}
        className="inline-flex min-h-16 items-center gap-4 rounded-full bg-paper-raised px-4 text-lg font-semibold text-ink ring-1 ring-line disabled:opacity-60"
      >
        <span className="relative h-8 w-14 rounded-full bg-line" aria-hidden="true">
          <span
            className={`absolute top-1 h-6 w-6 rounded-full bg-brand ${online ? "left-7" : "left-1"}`}
          />
        </span>
        {online ? "Online" : "Offline"}
      </button>
      {approved && !online && !everOnline && !promptDismissed ? (
        <div className="mt-3">
          <p className="text-base text-ink">You&apos;re approved! Switch Online whenever you&apos;re ready to see and accept jobs.</p>
          <form action={dismissOnlinePrompt} className="mt-2">
            <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-brand">
              Dismiss
            </button>
          </form>
        </div>
      ) : null}
      {approved && !online && (everOnline || promptDismissed) ? (
        <p className="mt-3 text-base text-ink">You&apos;re Offline — you won&apos;t get new job alerts.</p>
      ) : null}
      {switchError ? (
        <p role="alert" className="mt-3 text-base text-danger">
          {switchError}{" "}
          <a href="#checklist" className="font-semibold underline">
            See steps
          </a>
        </p>
      ) : null}
    </section>
    {showFeed ? (
    <div id="jobs" className="mt-6">
      <p className="mt-4 text-base text-muted">
        You can browse while Offline. Claiming or offering requires Online.
      </p>
      <div className="mt-4">
        <button
          type="button"
          role="switch"
          aria-checked={showAll}
          aria-label="Show all Georgia jobs"
          onClick={() => void toggleShowAll()}
          className="inline-flex min-h-12 items-center gap-3 text-base font-semibold text-ink"
        >
          <span className="relative h-8 w-14 rounded-full bg-line" aria-hidden="true">
            <span className={`absolute top-1 h-6 w-6 rounded-full bg-brand ${showAll ? "left-7" : "left-1"}`} />
          </span>
          Show all Georgia jobs
        </button>
        <p className="mt-3 text-base text-ink">
          Showing jobs in: {summary || "your areas"}{" "}
          <button type="button" onClick={() => setEditingAreas((open) => !open)} className="font-semibold text-brand">
            Edit
          </button>
        </p>
        {editingAreas ? (
          <div className="mt-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
            <CoverageEditor
              value={areas}
              persist
              onChange={(next) => {
                setAreas(next);
                void load();
              }}
            />
          </div>
        ) : null}
      </div>
      <form
        className="mt-4 space-y-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line"
        onSubmit={(event) => {
          event.preventDefault();
          void saveOptions(filterServices, filterFit);
        }}
      >
        <p className="font-semibold text-ink">Optional filters</p>
        <label className="block text-base font-semibold text-ink">
          Services
          <input
            value={filterServices}
            onChange={(event) => setFilterServices(event.target.value)}
            onBlur={(event) => void saveOptions(event.target.value, filterFit)}
            placeholder="delivery, junk"
            className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4"
          />
        </label>
        <label className="flex min-h-12 items-center gap-3 text-base">
          <input
            type="checkbox"
            checked={filterFit}
            onChange={(event) => {
              setFilterFit(event.target.checked);
              void saveOptions(filterServices, event.target.checked);
            }}
          />
          Only jobs my vehicle fits
        </label>
        {filterNote ? <p className="text-base text-ink">{filterNote}</p> : null}
      </form>
      {feedError ? <p role="alert" className="mt-3 text-base text-danger">{feedError}</p> : null}
      <div className="mt-4 flex gap-2">
        <button type="button" className="min-h-12 rounded-full bg-ink px-4 font-semibold text-white" aria-pressed={!mapView} onClick={() => setMapView(false)}>
          List
        </button>
        <button type="button" className="min-h-12 rounded-full bg-paper-raised px-4 font-semibold text-ink ring-1 ring-line" aria-pressed={mapView} onClick={() => setMapView(true)}>
          Map
        </button>
      </div>
      {mapView ? <div className="mt-4"><FeedMap jobs={jobs} /></div> : null}
      {jobs.length === 0 ? (
        <p className="mt-6 text-base text-muted">
          {showAll ? "No open jobs right now." : "No jobs in your areas right now — Show all Georgia jobs or Edit areas."}
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {jobs.map((job) => (
            <li key={job.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
              <p className="text-sm font-semibold text-brand">Available</p>
              <p className="mt-2 text-lg font-semibold text-ink">{job.service.replaceAll("_", " ")}</p>
              <p className="mt-1 text-base">
                {job.pickup_area}
                {job.dropoff_area ? ` to ${job.dropoff_area}` : ""}
                {job.distance_miles != null ? ` · ${job.distance_miles} mi trip` : ""}
                {job.miles_from_you != null ? ` · ~${Math.round(Number(job.miles_from_you))} mi from you` : ""}
              </p>
              <p>
                {job.required_vehicle?.replaceAll("_", " ") ?? "Any vehicle"} · {job.help_loading ? "2 people" : "1 person"} · Stairs {job.stairs_pickup}
                {job.stairs_dropoff != null ? ` / ${job.stairs_dropoff}` : ""}
              </p>
              <p>
                {job.preferred_date}
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
              <OfferActions
                job={job}
                canAct={online && approved && (!job.required_vehicle || job.required_vehicle === vehicleType)}
                blockedReason={
                  !approved
                    ? "Finish setup to accept jobs."
                    : job.required_vehicle && job.required_vehicle !== vehicleType
                      ? "This job needs a different vehicle."
                      : null
                }
                onDone={() => void load()}
              />
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
    ) : null}
    </>
  );
}
