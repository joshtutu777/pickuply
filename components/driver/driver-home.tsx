"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { acceptDriverTerms, dismissOnlinePrompt } from "@/app/driver/actions";
import Link from "next/link";
import { services } from "@/lib/constants";
import type { FeeSettings } from "@/lib/fees";
import { recordFunnel } from "@/lib/funnel";
import { CoverageEditor } from "@/components/driver/coverage-editor";
import { FeedMap } from "@/components/maps/feed-map";
import { coverageSummary, type CoverageDraft } from "@/lib/driver/coverage";
import { georgiaSectionNote, rpcCount } from "@/lib/driver/georgia-feed";
import {
  cardButtonLabel,
  fromYouLabel,
  jobTypeLabel,
  latestOfferByJob,
  offerAmountCents,
  offerCardLine,
  pickupTimeLabel,
  routeLabel,
  tripDistanceLabel,
  type StoredOffer,
} from "@/lib/driver/feed-card";
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
  date_group: string;
};

const dateGroups = [
  ["today", "Today"],
  ["tomorrow", "Tomorrow"],
  ["later_week", "Later this week"],
  ["later", "Later"],
] as const;

function toCard(job: FeedJob): FeedCard {
  return { ...job, photos: [], earningsCents: job.driver_pay_cents };
}

type FeedCard = FeedJob & { photos: string[]; earningsCents: number | null };

function JobCard({
  job,
  note,
  offer,
}: {
  job: FeedCard;
  note: string | null;
  offer: StoredOffer | null;
}) {
  const offerLine = offer ? offerCardLine(offer.status, offerAmountCents(offer.driverAmountCents, offer.platformFeeCents)) : null;
  return (
    <li id={`job-${job.id}`} className="min-w-0">
      <Link href={`/driver/open/${job.id}`} className="block overflow-hidden rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">{jobTypeLabel(job.service)}</h2>
          <p className="shrink-0 rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand">Available</p>
        </div>
        <p className="mt-2 text-base text-ink">{routeLabel(job.pickup_area, job.dropoff_area)}</p>
        <p className="text-base text-ink">{tripDistanceLabel(job.distance_miles == null ? null : Number(job.distance_miles))}</p>
        <p className="text-base text-ink">{fromYouLabel(job.miles_from_you == null ? null : Number(job.miles_from_you))}</p>
        <p className="text-base text-ink">Pickup time {pickupTimeLabel(job.preferred_date, job.time_window)}</p>
        {offerLine ? <p className="mt-2 text-base font-semibold text-ink">{offerLine}</p> : null}
        {note ? <p className="mt-1 text-base text-ink">{note}</p> : null}
        <span className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-4 text-center text-base font-semibold text-white">
          {cardButtonLabel(offerLine != null)}
        </span>
      </Link>
    </li>
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
  termsAccepted,
  coverage,
  offlineAlerts,
  setup = null,
}: {
  isOnline: boolean;
  userId: string;
  showFeed: boolean;
  approved: boolean;
  vehicleType: string | null;
  everOnline: boolean;
  promptDismissed: boolean;
  termsAccepted: boolean;
  coverage: CoverageDraft;
  offlineAlerts: boolean;
  fees: FeeSettings;
  setup?: ReactNode;
}) {
  const [online, setOnline] = useState(isOnline);
  const [offlineAlertsOn, setOfflineAlertsOn] = useState(offlineAlerts);
  const [matched, setMatched] = useState<FeedCard[]>([]);
  const [georgia, setGeorgia] = useState<FeedCard[]>([]);
  const [georgiaTotal, setGeorgiaTotal] = useState(0);
  const [georgiaOpenTotal, setGeorgiaOpenTotal] = useState(0);
  const [georgiaHasMore, setGeorgiaHasMore] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [areas, setAreas] = useState(coverage);
  const [editingAreas, setEditingAreas] = useState(false);
  const [mapView, setMapView] = useState(false);
  const [sortKey, setSortKey] = useState("nearest");
  const [serviceFilter, setServiceFilter] = useState("");
  const [maxMiles, setMaxMiles] = useState("");
  const [dateFilter, setDateFilter] = useState("any");
  const [vehicleFitOnly, setVehicleFitOnly] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [offers, setOffers] = useState<Map<string, StoredOffer>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef(false);
  const loadRef = useRef<() => Promise<void>>(async () => {});
  const pullStart = useRef(0);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const summary = coverageSummary({ cities: areas.cities, zips: areas.zips, radiusMiles: areas.radius });

  const finishFlight = useCallback(() => {
    inFlight.current = false;
    if (pending.current) {
      pending.current = false;
      void loadRef.current();
    }
  }, []);

  const attachOffers = useCallback(async (ids: string[]) => {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const { data, error } = await createClient()
      .from("job_offers")
      .select("job_id, status, driver_amount_cents, platform_fee_cents, created_at")
      .eq("driver_id", userId)
      .in("job_id", unique);
    if (error || !data) return;
    const latest = latestOfferByJob(
      data.map((row) => ({
        jobId: row.job_id,
        status: row.status,
        driverAmountCents: row.driver_amount_cents,
        platformFeeCents: row.platform_fee_cents,
        createdAt: row.created_at,
      })),
    );
    setOffers((current) => {
      const next = new Map(current);
      for (const [jobId, offer] of latest) next.set(jobId, offer);
      return next;
    });
  }, [userId]);

  const loadFeed = useCallback(async () => {
    const token = ++generation.current;
    if (inFlight.current) {
      pending.current = true;
      return;
    }
    inFlight.current = true;
    setRefreshing(true);
    const supabase = createClient();
    const countArgs = {
      p_service: serviceFilter || null,
      p_max_miles: maxMiles ? Number(maxMiles) : null,
      p_date: dateFilter,
      p_vehicle_fit: vehicleFitOnly,
    };
    const [matchedResult, pageResult, filteredCount, openCount] = await Promise.all([
      supabase.rpc("driver_matched_feed"),
      supabase.rpc("driver_georgia_page", { ...countArgs, p_sort: sortKey, p_limit: 21, p_offset: 0 }),
      supabase.rpc("driver_georgia_count", countArgs),
      supabase.rpc("driver_georgia_count"),
    ]);
    if (token !== generation.current) {
      finishFlight();
      return;
    }
    if (matchedResult.error || pageResult.error || filteredCount.error || openCount.error) {
      setFeedError("We couldn't load jobs.");
      setRefreshing(false);
      finishFlight();
      return;
    }
    const matchedRows = (matchedResult.data ?? []) as FeedJob[];
    const pageRows = ((pageResult.data ?? []) as FeedJob[]).slice(0, 20);
    setMatched(matchedRows.map(toCard));
    setGeorgia(pageRows.map(toCard));
    setGeorgiaHasMore(((pageResult.data ?? []) as FeedJob[]).length > 20);
    setGeorgiaTotal(rpcCount(filteredCount.data));
    setGeorgiaOpenTotal(rpcCount(openCount.data));
    setUpdatedAt(new Date());
    setFeedError(null);
    setRefreshing(false);
    finishFlight();
    void attachOffers([...matchedRows, ...pageRows].map((job) => job.id));
  }, [attachOffers, dateFilter, finishFlight, maxMiles, serviceFilter, sortKey, vehicleFitOnly]);

  const loadMore = useCallback(async () => {
    if (inFlight.current || !georgiaHasMore) return;
    inFlight.current = true;
    const token = generation.current;
    const supabase = createClient();
    const pageResult = await supabase.rpc("driver_georgia_page", {
      p_limit: 21,
      p_offset: georgia.length,
      p_sort: sortKey,
      p_service: serviceFilter || null,
      p_max_miles: maxMiles ? Number(maxMiles) : null,
      p_date: dateFilter,
      p_vehicle_fit: vehicleFitOnly,
    });
    if (token !== generation.current) {
      finishFlight();
      return;
    }
    if (pageResult.error) {
      setFeedError("We couldn't load jobs.");
      finishFlight();
      return;
    }
    const pageRows = (pageResult.data ?? []) as FeedJob[];
    const next = pageRows.slice(0, 20);
    setGeorgia((current) => [...current, ...next.map(toCard)]);
    setGeorgiaHasMore(pageRows.length > 20);
    finishFlight();
    void attachOffers(next.map((job) => job.id));
  }, [attachOffers, dateFilter, finishFlight, georgia.length, georgiaHasMore, maxMiles, serviceFilter, sortKey, vehicleFitOnly]);

  useEffect(() => {
    loadRef.current = loadFeed;
  }, [loadFeed]);

  useEffect(() => {
    if (!showFeed) return;
    const start = window.setTimeout(() => {
      void loadFeed();
    }, 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadFeed();
    }, 20000);
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void loadFeed();
    };
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("online", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);
    const supabase = createClient();
    const channel = supabase
      .channel(`driver-feed-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "job_feed_signals" }, () => {
        void loadFeed();
      })
      .subscribe();
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("online", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
      void supabase.removeChannel(channel);
    };
  }, [loadFeed, showFeed, userId]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !georgiaHasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [georgiaHasMore, georgia.length, loadMore]);

  async function goOnline(): Promise<{ online: boolean; error: string | null }> {
    setBusy(true);
    setSwitchError(null);
    const supabase = createClient();
    const { error: onlineError } = await supabase.rpc("set_driver_online", { go_online: true });
    const confirmed = await supabase.from("drivers").select("is_online").eq("profile_id", userId).maybeSingle();
    const nowOnline = Boolean(confirmed.data?.is_online);
    setBusy(false);
    setOnline(nowOnline);
    if (onlineError || !nowOnline) {
      const text = onlineError?.message ?? "You are still Offline.";
      setSwitchError(text);
      return { online: false, error: text };
    }
    void recordFunnel({ event: "driver_online", step: "online" });
    return { online: true, error: null };
  }

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

  const termsError = switchError?.includes("Driver Terms") ?? false;
  const visibleJobs = [...matched, ...georgia];
  const jobAction = (job: FeedCard) => {
    const vehicleOk = !job.required_vehicle || job.required_vehicle === vehicleType;
    return {
      vehicleOk,
      blockedReason: !approved
        ? "Finish setup to accept jobs."
        : !vehicleOk
          ? "This job needs a different vehicle."
          : null,
    };
  };

  return (
    <>
    {termsAccepted ? null : (
      <section id="driver-terms" className="mb-4 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">Driver Terms</h2>
        <p className="mt-2 text-base text-ink">
          <a href="/terms/driver" className="font-semibold text-brand">
            Review the Driver Terms
          </a>
        </p>
        <form action={acceptDriverTerms} className="mt-3">
          <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-5 font-semibold text-white">
            Review and accept the updated Driver Terms
          </button>
        </form>
      </section>
    )}
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
      <label className="mt-4 flex min-h-12 items-center gap-3 text-base font-semibold text-ink">
        <input
          type="checkbox"
          checked={offlineAlertsOn}
          onChange={(event) => {
            const next = event.target.checked;
            setOfflineAlertsOn(next);
            void createClient().rpc("set_offline_job_alerts", { enabled: next });
          }}
        />
        Job alerts while Offline
      </label>
      {approved && !online && !everOnline && !promptDismissed ? (
        <div className="mt-3">
          <p className="text-base text-ink">You&apos;re ready to drive! Switch Online whenever you&apos;re ready to start accepting jobs.</p>
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
          {termsError ? "Accept the Driver Terms to go Online" : switchError}{" "}
          <a href={termsError ? "#driver-terms" : "#checklist"} className="font-semibold underline">
            {termsError ? "Review" : "See steps"}
          </a>
        </p>
      ) : null}
    </section>
    <div className={setup ? "flex flex-col" : undefined}>
    {setup ? <div className="order-1 sm:order-2">{setup}</div> : null}
    {showFeed ? (
    <div
      id="jobs"
      className={setup ? "order-2 mt-6 sm:order-1" : "mt-6"}
      onTouchStart={(event) => {
        pullStart.current = event.touches[0]?.clientY ?? 0;
      }}
      onTouchEnd={(event) => {
        const end = event.changedTouches[0]?.clientY ?? 0;
        if (end - pullStart.current > 80 && window.scrollY < 8) void loadFeed();
      }}
    >
      <p className="mt-4 text-base font-semibold text-ink">You are {online ? "Online" : "Offline"}.</p>
      <p className="mt-1 text-base text-muted">
        {approved
          ? "You can browse while Offline. Claiming or offering requires Online."
          : "Browse only until Pickuply approves you. You cannot take a job yet."}
      </p>
      <p className="mt-3 text-lg font-semibold text-ink">Available Jobs ({matched.length + georgiaTotal})</p>
      <div className="mt-4">
        <p className="text-base text-ink">
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
                void loadFeed();
              }}
            />
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void loadFeed()}
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-5 font-semibold text-white"
        >
          Refresh
        </button>
        {updatedAt ? (
          <p className="text-base text-ink">Updated {updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
        ) : null}
        {refreshing && updatedAt ? <p className="text-base text-muted">Refreshing…</p> : null}
      </div>
      {feedError ? (
        <p role="alert" className="mt-3 text-base text-danger">
          {feedError}{" "}
          <button type="button" onClick={() => void loadFeed()} className="font-semibold underline">
            Try again
          </button>
        </p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <button type="button" className="min-h-12 rounded-full bg-ink px-4 font-semibold text-white" aria-pressed={!mapView} onClick={() => setMapView(false)}>
          List
        </button>
        <button type="button" className="min-h-12 rounded-full bg-paper-raised px-4 font-semibold text-ink ring-1 ring-line" aria-pressed={mapView} onClick={() => setMapView(true)}>
          Map
        </button>
      </div>
      {mapView ? <div className="mt-4"><FeedMap jobs={visibleJobs} /></div> : null}
      <section aria-label="Matched for You" className="mt-6">
        <h2 className="font-display text-2xl font-semibold text-ink">Matched for You ({matched.length})</h2>
        {updatedAt && matched.length === 0 ? (
          <p className="mt-3 text-base text-muted">No jobs in your areas right now — see all Georgia requests below.</p>
        ) : null}
        {!updatedAt && matched.length === 0 ? <p className="mt-3 text-base text-muted">Loading jobs…</p> : null}
        {dateGroups.map(([key, label]) => {
          const group = matched.filter((job) => job.date_group === key);
          if (group.length === 0) return null;
          return (
            <div key={key} className="mt-4">
              <h3 className="text-lg font-semibold text-ink">{label} ({group.length})</h3>
              <ul className="mt-3 space-y-3">
                {group.map((job) => {
                  const action = jobAction(job);
                  return (
                    <JobCard key={job.id} job={job} note={action.blockedReason} offer={offers.get(job.id) ?? null} />
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>
      <section aria-label="All Georgia Requests" className="mt-8">
        <h2 className="font-display text-2xl font-semibold text-ink">All Georgia Requests ({georgiaTotal})</h2>
        <p className="mt-1 text-base text-ink">Open jobs outside your saved areas. Jobs in your areas stay under Matched for You.</p>
        <div className="mt-4 grid gap-3">
          <label className="block text-base font-semibold text-ink">
            Sort
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4">
              <option value="nearest">Nearest pickup</option>
              <option value="newest">Newest</option>
              <option value="pay">Highest pay</option>
              <option value="soonest">Soonest</option>
              <option value="farthest">Farthest</option>
            </select>
          </label>
          <label className="block text-base font-semibold text-ink">
            Service
            <select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4">
              <option value="">All services</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>{service.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-base font-semibold text-ink">
            Distance
            <select value={maxMiles} onChange={(event) => setMaxMiles(event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4">
              <option value="">Any distance</option>
              <option value="10">Within 10 miles</option>
              <option value="25">Within 25 miles</option>
              <option value="50">Within 50 miles</option>
              <option value="100">Within 100 miles</option>
            </select>
          </label>
          <label className="block text-base font-semibold text-ink">
            Pickup date
            <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4">
              <option value="any">Any date</option>
              <option value="today">Today</option>
              <option value="tomorrow">Tomorrow</option>
              <option value="week">This week</option>
            </select>
          </label>
          <label className="flex min-h-12 items-center gap-3 text-base font-semibold text-ink">
            <input type="checkbox" checked={vehicleFitOnly} onChange={(event) => setVehicleFitOnly(event.target.checked)} />
            Only jobs my vehicle fits
          </label>
        </div>
        {georgiaSectionNote({
          loaded: updatedAt != null,
          matched: matched.length,
          shown: georgia.length,
          filteredTotal: georgiaTotal,
          unfilteredTotal: georgiaOpenTotal,
        }) ? (
          <p className="mt-4 text-base text-muted">
            {georgiaSectionNote({
              loaded: updatedAt != null,
              matched: matched.length,
              shown: georgia.length,
              filteredTotal: georgiaTotal,
              unfilteredTotal: georgiaOpenTotal,
            })}
          </p>
        ) : null}
        {georgia.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {georgia.map((job) => {
              const action = jobAction(job);
              return (
                <JobCard key={job.id} job={job} note={action.blockedReason} offer={offers.get(job.id) ?? null} />
              );
            })}
          </ul>
        ) : null}
        {georgiaHasMore ? <div ref={sentinel} className="mt-4 text-base text-muted">Loading more…</div> : null}
      </section>
    </div>
    ) : null}
    </div>
    </>
  );
}
