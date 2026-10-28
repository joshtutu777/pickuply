"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { acceptDriverTerms, dismissOnlinePrompt } from "@/app/driver/actions";
import { useRouter } from "next/navigation";
import { services } from "@/lib/constants";
import { offerBreakdown, type FeeSettings } from "@/lib/fees";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { recordFunnel } from "@/lib/funnel";
import { ArrivalTimeFields } from "@/components/driver/arrival-time";
import { CoverageEditor } from "@/components/driver/coverage-editor";
import { FeedMap } from "@/components/maps/feed-map";
import { coverageSummary, type CoverageDraft } from "@/lib/driver/coverage";
import { compareNewest, mergeFeedCards } from "@/lib/driver/feed-order";
import { takenJobMessage } from "@/lib/jobs/taken-message";
import {
  addCalendarDays,
  arrivalError,
  arrivalSummary,
  clockValue,
  defaultOfferArrivalLeadMinutes,
  formatScheduledPickup,
  georgiaWallClock,
  windowArrivalError,
  georgiaDateISO,
  windowIsOpen,
  type PickupPlan,
} from "@/lib/time/pickup-schedule";
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
  created_at: string;
};

function toCard(job: FeedJob): FeedCard {
  return { ...job, photos: [], earningsCents: job.driver_pay_cents, schedule: undefined };
}

function countFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

type FeedCard = FeedJob & { photos: string[]; earningsCents: number | null; schedule?: PickupPlan | null };

type OfferDraft = {
  amount: string;
  date: string;
  hour: string;
  minute: string;
  meridiem: string;
  windowId: string;
  review: "accept" | "offer" | "claim" | null;
};

function itemLine(job: FeedCard): string {
  const name = job.service.replaceAll("_", " ");
  const size = job.size ? ` ${String(job.size).replaceAll("_", " ")}` : "";
  const count = job.pieces != null ? `, ${job.pieces} ${job.pieces === 1 ? "piece" : "pieces"}` : "";
  return `${name}${size}${count}`;
}

function stairLabel(pickup: number, dropoff: number | null) {
  const drop = dropoff ?? 0;
  if (pickup === 0 && drop === 0) return "No stairs reported";
  if (dropoff == null) return `Stairs ${pickup}`;
  return `Stairs ${pickup} / ${dropoff}`;
}

function OfferMath({ cents, settings }: { cents: number; settings: FeeSettings }) {
  if (cents <= 0) return null;
  let price: ReturnType<typeof offerBreakdown>;
  try {
    price = offerBreakdown(cents, settings);
  } catch {
    return <p className="text-base text-danger">Enter an amount that can pay the driver.</p>;
  }
  return (
    <div className="grid gap-1 rounded-2xl bg-paper p-3 text-base">
      <p>Job Amount: {formatCents(cents)}</p>
      <p className="font-semibold">Your Estimated Earnings: {formatCents(price.driverEarningsCents)}</p>
    </div>
  );
}

function OfferActions({
  job,
  canAct,
  blockedReason,
  fees,
  arrivalLeadMinutes,
  drafts,
  onDone,
  onRejected,
}: {
  job: FeedCard;
  canAct: boolean;
  blockedReason: string | null;
  fees: FeeSettings;
  arrivalLeadMinutes: number;
  drafts: { current: Map<string, OfferDraft> };
  onDone: () => void;
  onRejected: (message: string) => void;
}) {
  const saved = drafts.current.get(job.id);
  const [amount, setAmount] = useState(saved?.amount ?? "");
  const [pickupDate, setPickupDate] = useState(saved?.date ?? "");
  const [hour, setHour] = useState(saved?.hour ?? "");
  const [minute, setMinute] = useState(saved?.minute ?? "");
  const [meridiem, setMeridiem] = useState(saved?.meridiem ?? "");
  const [windowId, setWindowId] = useState(saved?.windowId ?? "");
  const [review, setReview] = useState<OfferDraft["review"]>(saved?.review ?? null);
  const [message, setMessage] = useState<{ text: string; alert: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  const submitLock = useRef(false);
  const router = useRouter();
  const pickupTime = clockValue({ hour, minute, meridiem }) ?? "";
  const offerCents = parseDollarsToCents(amount) ?? 0;
  useEffect(() => {
    drafts.current.set(job.id, { amount, date: pickupDate, hour, minute, meridiem, windowId, review });
  }, [amount, drafts, hour, job.id, meridiem, minute, pickupDate, review, windowId]);
  const claimable = job.pricing_method === "quote" && job.driver_pay_cents != null;
  const driverQuote = job.pricing_method === "quote" && !claimable;
  const posted = job.pricing_method === "fixed" ? job.offer_cents : null;

  const scheduleProblem = scheduleGap(job.schedule, pickupDate, pickupTime, windowId, arrivalLeadMinutes);

  async function send(kind: "accept" | "claim" | "offer") {
    if (sending || submitLock.current) return;
    submitLock.current = true;
    const gap = scheduleGap(job.schedule, pickupDate, pickupTime, windowId, arrivalLeadMinutes);
    if (gap) {
      submitLock.current = false;
      setMessage({ text: gap, alert: true });
      onRejected(gap);
      return;
    }
    setSending(true);
    setMessage(null);
    const supabase = createClient();
    const proposal = scheduleArgs(job.schedule, pickupDate, pickupTime, windowId);
    try {
    const result =
      kind === "claim"
        ? await supabase.rpc("claim_job", { target_job: job.id, ...proposal })
        : await supabase.rpc("submit_offer", {
            target_job: job.id,
            kind,
            earnings_cents: kind === "accept" ? null : offerCents,
            reason: "",
            ...proposal,
          });
    if (result.error) {
      const text = takenJobMessage(String(result.error.message || "That offer was not saved."));
      onRejected(text);
      setMessage({ text, alert: true });
      return;
    }
    const submitted = kind === "offer" || kind === "accept" ? offerBreakdown(kind === "accept" ? posted ?? 0 : offerCents, fees) : null;
    setReview(null);
    setMessage({
      text: kind === "claim"
        ? "You are assigned. Payment is still due."
        : driverQuote
          ? `Quote sent. Your estimated earnings ${formatCents(submitted?.driverEarningsCents ?? 0)}.`
          : `Offer submitted successfully. Your estimated earnings ${formatCents(submitted?.driverEarningsCents ?? 0)}.`,
      alert: false,
    });
    if (kind === "claim" || kind === "accept") {
      void recordFunnel({ event: "driver_claim", step: kind, service: job.service, pricing: job.pricing_method });
    }
    if (kind === "claim") router.refresh();
    onDone();
    } finally {
      submitLock.current = false;
      setSending(false);
    }
  }

  function changeTime(part: "hour" | "minute" | "meridiem", value: string) {
    if (part === "hour") setHour(value);
    if (part === "minute") setMinute(value);
    if (part === "meridiem") setMeridiem(value);
    setReview(null);
  }

  const chosenWindow = job.schedule?.windows.find((window) => window.id === windowId);
  const proposalDate = job.schedule?.availability === "windows"
    ? (chosenWindow ? georgiaWallClock(chosenWindow.starts_at).date : "")
    : pickupDate;
  const summary = arrivalSummary(proposalDate, pickupTime) ?? "";

  const confirmLabel = review === "claim"
    ? "Confirm & Claim"
    : review === "accept"
      ? "Confirm & Accept"
      : "Confirm & Submit Offer";

  return (
    <div className="mt-3 grid gap-3">
      <PickupProposal
        plan={job.schedule}
        date={pickupDate}
        idPrefix={job.id}
        hour={hour}
        minute={minute}
        meridiem={meridiem}
        summary={summary}
        windowId={windowId}
        arrivalLeadMinutes={arrivalLeadMinutes}
        onDate={(value) => {
          setPickupDate(value);
          setReview(null);
        }}
        onHour={(value) => changeTime("hour", value)}
        onMinute={(value) => changeTime("minute", value)}
        onMeridiem={(value) => changeTime("meridiem", value)}
        onWindow={(value) => {
          setWindowId(value);
          setReview(null);
        }}
      />
      {review ? (
        <div className="grid gap-3 rounded-2xl bg-paper p-3 ring-1 ring-line">
          <p className="font-semibold">Review this offer</p>
          <p>Item: {itemLine(job)}</p>
          <p>Pickup: {summary || "Choose an arrival time."}</p>
          {chosenWindow ? <p>Availability: {formatScheduledPickup(chosenWindow.starts_at, chosenWindow.ends_at)}</p> : null}
          {review === "offer" ? <p>Your offer: {formatCents(offerCents)}</p> : null}
          {review === "accept" && posted != null ? <p>Posted price: {formatCents(posted)}</p> : null}
          {review === "offer" || review === "accept" ? <OfferMath cents={review === "accept" ? posted ?? 0 : offerCents} settings={fees} /> : null}
          <button
            type="button"
            disabled={!canAct || sending || scheduleProblem != null}
            aria-busy={sending}
            onClick={() => void send(review)}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand font-semibold text-white disabled:opacity-60"
          >
            {sending ? "Submitting..." : confirmLabel}
          </button>
          <button type="button" disabled={sending} onClick={() => setReview(null)} className="inline-flex min-h-12 items-center font-semibold text-brand disabled:opacity-60">
            Edit Offer
          </button>
        </div>
      ) : claimable ? (
        <button
          type="button"
          disabled={!canAct || sending || scheduleProblem != null}
          onClick={() => setReview("claim")}
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand font-semibold text-white disabled:opacity-60"
        >
          Review claim
        </button>
      ) : (
        <>
          {posted != null ? (
            <>
              <OfferMath cents={posted} settings={fees} />
              <button
                type="button"
                disabled={!canAct || sending || scheduleProblem != null}
                onClick={() => setReview("accept")}
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand font-semibold text-white disabled:opacity-60"
              >
                Review posted price
              </button>
            </>
          ) : null}
          <label className="text-base font-semibold text-ink">
            {driverQuote ? "Your quote ($)" : "Offer Amount ($)"}
            <input
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setReview(null);
              }}
              inputMode="decimal"
              className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4"
            />
          </label>
          <OfferMath cents={offerCents} settings={fees} />
          <button
            type="button"
            disabled={!canAct || offerCents <= 0 || scheduleProblem != null}
            onClick={() => setReview("offer")}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand font-semibold text-white disabled:opacity-60"
          >
            Review offer
          </button>
        </>
      )}
      {blockedReason ? <p className="text-base text-ink">{blockedReason}</p> : null}
      {message ? (
        <p role={message.alert ? "alert" : "status"} className={message.alert ? "text-base text-danger" : "text-base text-ink"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

function JobCard({
  job,
  canAct,
  blockedReason,
  fees,
  arrivalLeadMinutes,
  drafts,
  onDone,
  onRejected,
}: {
  job: FeedCard;
  canAct: boolean;
  blockedReason: string | null;
  fees: FeeSettings;
  arrivalLeadMinutes: number;
  drafts: { current: Map<string, OfferDraft> };
  onDone: () => void;
  onRejected: (message: string) => void;
}) {
  return (
    <li id={`job-${job.id}`} className="scroll-mt-24 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <p className="text-sm font-semibold text-brand">Available</p>
      <p className="mt-2 text-lg font-semibold text-ink">{job.service.replaceAll("_", " ")}</p>
      <p className="mt-1 text-base">
        {job.pickup_area}
        {job.dropoff_area ? ` to ${job.dropoff_area}` : ""}
        {job.distance_miles != null ? ` · ${job.distance_miles} mi trip` : ""}
        {job.miles_from_you != null ? ` · ~${Math.round(Number(job.miles_from_you))} mi from you` : ""}
      </p>
      <p>
        {job.required_vehicle?.replaceAll("_", " ") ?? "Any vehicle"} · {job.help_loading ? "2 people" : "1 person"} ·{" "}
        {stairLabel(job.stairs_pickup, job.stairs_dropoff)}
      </p>
      <p>{scheduleLine(job)}</p>
      {job.pricing_method === "fixed" && job.offer_cents != null ? (
        <p>Job Amount: {formatCents(job.offer_cents)}</p>
      ) : null}
      {job.pricing_method === "range" && job.budget_min_cents != null && job.budget_max_cents != null ? (
        <p>
          Budget {formatCents(job.budget_min_cents)}–{formatCents(job.budget_max_cents)}
        </p>
      ) : null}
      {job.earningsCents != null ? (
        <p className="font-semibold">Your Estimated Earnings: {formatCents(job.earningsCents)}</p>
      ) : null}
      <OfferActions job={job} canAct={canAct} blockedReason={blockedReason} fees={fees} arrivalLeadMinutes={arrivalLeadMinutes} drafts={drafts} onDone={onDone} onRejected={onRejected} />
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
  fees,
  arrivalLeadMinutes = defaultOfferArrivalLeadMinutes,
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
  arrivalLeadMinutes?: number;
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
  const [offerNotice, setOfferNotice] = useState<string | null>(null);
  useEffect(() => {
    const saved = sessionStorage.getItem("pickuply.offer-notice");
    if (saved) setOfferNotice(saved);
  }, []);
  function rememberRejection(message: string) {
    sessionStorage.setItem("pickuply.offer-notice", message);
    setOfferNotice(message);
    void loadFeed();
  }
  const [busy, setBusy] = useState(false);
  const [areas, setAreas] = useState(coverage);
  const [editingAreas, setEditingAreas] = useState(false);
  const [mapView, setMapView] = useState(false);
  const [sortKey, setSortKey] = useState("newest");
  const [serviceFilter, setServiceFilter] = useState("");
  const [maxMiles, setMaxMiles] = useState("");
  const [dateFilter, setDateFilter] = useState("any");
  const [vehicleFitOnly, setVehicleFitOnly] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef(false);
  const editing = useRef(false);
  const drafts = useRef(new Map<string, OfferDraft>());
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

  const enrich = useCallback(async (token: number, rows: FeedJob[]) => {
    if (rows.length === 0) return;
    const supabase = createClient();
    const ids = [...new Set(rows.map((job) => job.id))];
    const schedules = new Map<string, PickupPlan>();
    let scheduleError = false;
    for (let index = 0; index < ids.length; index += 50) {
      const scheduleResult = await supabase.rpc("open_job_schedules", { job_ids: ids.slice(index, index + 50) });
      if (scheduleResult.error) {
        scheduleError = true;
        break;
      }
      for (const row of (scheduleResult.data ?? []) as {
        job_id: string;
        pickup_availability: PickupPlan["availability"];
        pickup_timezone: string | null;
        windows: PickupPlan["windows"];
      }[]) {
        schedules.set(row.job_id, {
          availability: row.pickup_availability,
          timezone: row.pickup_timezone,
          windows: Array.isArray(row.windows) ? row.windows : [],
        });
      }
    }
    const photos = new Map<string, string[]>();
    const { data: photoRows } = await supabase
      .from("job_photos")
      .select("job_id, storage_path, stage")
      .in("job_id", rows.map((job) => job.id))
      .eq("stage", "request");
    for (const photo of photoRows ?? []) {
      if (photo.stage !== "request") continue;
      const signed = await supabase.storage.from("job-photos").createSignedUrl(photo.storage_path, 300);
      if (!signed.data?.signedUrl) continue;
      photos.set(photo.job_id, [...(photos.get(photo.job_id) ?? []), signed.data.signedUrl]);
    }
    if (token !== generation.current) return;
    const apply = (current: FeedCard[]) =>
      current.map((job) => ({
        ...job,
        photos: photos.get(job.id) ?? job.photos,
        schedule: scheduleError ? null : schedules.get(job.id) ?? null,
      }));
    setMatched(apply);
    setGeorgia(apply);
  }, []);

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
    setMatched((current) => mergeFeedCards(current, matchedRows.map(toCard)).sort(compareNewest));
    setGeorgia((current) => mergeFeedCards(current, pageRows.map(toCard)));
    setGeorgiaHasMore(((pageResult.data ?? []) as FeedJob[]).length > 20);
    setGeorgiaTotal(countFrom(filteredCount.data));
    setGeorgiaOpenTotal(countFrom(openCount.data));
    setUpdatedAt(new Date());
    setFeedError(null);
    setRefreshing(false);
    finishFlight();
    void enrich(token, [...matchedRows, ...pageRows]);
  }, [dateFilter, enrich, finishFlight, maxMiles, serviceFilter, sortKey, vehicleFitOnly]);

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
    void enrich(token, next);
  }, [dateFilter, enrich, finishFlight, georgia.length, georgiaHasMore, maxMiles, serviceFilter, sortKey, vehicleFitOnly]);

  useEffect(() => {
    loadRef.current = loadFeed;
  }, [loadFeed]);

  useEffect(() => {
    if (!showFeed) return;
    const start = window.setTimeout(() => {
      void loadFeed();
    }, 0);
    const refreshIfIdle = () => {
      if (editing.current) {
        pending.current = true;
        return;
      }
      if (document.visibilityState === "visible") void loadFeed();
    };
    const timer = window.setInterval(refreshIfIdle, 20000);
    document.addEventListener("visibilitychange", refreshIfIdle);
    window.addEventListener("online", refreshIfIdle);
    const supabase = createClient();
    const channel = supabase
      .channel(`driver-feed-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "job_feed_signals" }, () => {
        refreshIfIdle();
      })
      .subscribe();
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfIdle);
      window.removeEventListener("online", refreshIfIdle);
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
  const jobAction = (job: FeedCard) => ({
    canAct: online && approved && (!job.required_vehicle || job.required_vehicle === vehicleType),
    blockedReason: !approved
      ? "Finish setup to accept jobs."
      : job.required_vehicle && job.required_vehicle !== vehicleType
        ? "This job needs a different vehicle."
        : null,
  });

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
      onFocusCapture={() => {
        editing.current = true;
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        const root = event.currentTarget;
        window.setTimeout(() => {
          const active = document.activeElement;
          if (active instanceof Node && root.contains(active)) return;
          editing.current = false;
          if (pending.current) {
            pending.current = false;
            void loadFeed();
          }
        }, 0);
      }}
      onTouchStart={(event) => {
        pullStart.current = event.touches[0]?.clientY ?? 0;
      }}
      onTouchEnd={(event) => {
        const end = event.changedTouches[0]?.clientY ?? 0;
        if (end - pullStart.current > 80 && window.scrollY < 8) void loadFeed();
      }}
    >
      <p className="mt-4 text-base text-muted">
        {approved
          ? "You can browse while Offline. Claiming or offering requires Online."
          : "Browse only until Pickuply approves you. You cannot take a job yet."}
      </p>
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
      {offerNotice ? (
        <p role="alert" className="mt-4 text-base text-danger">
          {offerNotice}
        </p>
      ) : null}
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
        {matched.length > 0 ? (
          <ul className="mt-3 space-y-4">
            {matched.map((job) => {
              const action = jobAction(job);
              return (
                <JobCard
                  key={job.id}
                  job={job}
                  canAct={action.canAct}
                  blockedReason={action.blockedReason}
                  fees={fees}
                  arrivalLeadMinutes={arrivalLeadMinutes}
                  drafts={drafts}
                  onDone={() => {
                    sessionStorage.removeItem("pickuply.offer-notice");
                    setOfferNotice(null);
                    void loadFeed();
                  }}
                  onRejected={rememberRejection}
                />
              );
            })}
          </ul>
        ) : null}
      </section>
      <section aria-label="All Georgia Requests" className="mt-8">
        <h2 className="font-display text-2xl font-semibold text-ink">All Georgia Requests ({georgiaTotal})</h2>
        <div className="mt-4 grid gap-3">
          <label className="block text-base font-semibold text-ink">
            Sort
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4">
              <option value="newest">Newest</option>
              <option value="nearest">Nearest pickup</option>
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
        {updatedAt && georgia.length === 0 && georgiaOpenTotal > 0 ? (
          <p className="mt-4 text-base text-muted">No requests match these filters.</p>
        ) : null}
        {georgia.length > 0 ? (
          <ul className="mt-4 space-y-4">
            {georgia.map((job) => {
              const action = jobAction(job);
              return (
                <JobCard
                  key={job.id}
                  job={job}
                  canAct={action.canAct}
                  blockedReason={action.blockedReason}
                  fees={fees}
                  arrivalLeadMinutes={arrivalLeadMinutes}
                  drafts={drafts}
                  onDone={() => {
                    sessionStorage.removeItem("pickuply.offer-notice");
                    setOfferNotice(null);
                    void loadFeed();
                  }}
                  onRejected={rememberRejection}
                />
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

function scheduleArgs(plan: PickupPlan | null | undefined, date: string, time: string, windowId: string) {
  if (!plan?.availability) return { proposed_date: null, proposed_time: null, window_id: null };
  if (plan.availability === "windows") {
    const chosen = plan.windows.find((window) => window.id === windowId);
    return {
      proposed_date: chosen ? georgiaWallClock(chosen.starts_at).date : null,
      proposed_time: time || null,
      window_id: windowId || null,
    };
  }
  return { proposed_date: date, proposed_time: time, window_id: null };
}

function scheduleGap(
  plan: PickupPlan | null | undefined,
  date: string,
  time: string,
  windowId: string,
  leadMinutes: number,
): string | null {
  if (plan === undefined) return "Loading pickup times.";
  if (plan === null) return "We couldn't load pickup times. Refresh and try again.";
  if (!plan.availability) return null;
  if (plan.availability === "windows") {
    const chosen = plan.windows.find((window) => window.id === windowId);
    if (!chosen) return "Select one of the customer's pickup windows.";
    return windowArrivalError(chosen, time);
  }
  return arrivalError(date, time, new Date(), leadMinutes);
}

function scheduleLine(job: FeedCard): string {
  const plan = job.schedule;
  if (!plan) return job.time_window ? `${job.preferred_date} · ${job.time_window}` : job.preferred_date;
  if (plan.availability === "anytime") return "Available anytime. Propose a pickup time.";
  if (plan.availability === "asap") return "As soon as possible. Propose your earliest arrival.";
  if (plan.availability === "windows") {
    const open = plan.windows.filter((window) => windowIsOpen(window.ends_at));
    if (open.length === 0) return "The customer's pickup windows have passed.";
    return open.map((window) => formatScheduledPickup(window.starts_at, window.ends_at)).join(" · ");
  }
  return job.time_window ? `${job.preferred_date} · ${job.time_window}` : job.preferred_date;
}

function PickupProposal({
  plan,
  date,
  idPrefix,
  hour,
  minute,
  meridiem,
  summary,
  windowId,
  arrivalLeadMinutes,
  onDate,
  onHour,
  onMinute,
  onMeridiem,
  onWindow,
}: {
  plan?: PickupPlan | null;
  date: string;
  idPrefix: string;
  hour: string;
  minute: string;
  meridiem: string;
  summary: string;
  windowId: string;
  arrivalLeadMinutes: number;
  onDate: (value: string) => void;
  onHour: (value: string) => void;
  onMinute: (value: string) => void;
  onMeridiem: (value: string) => void;
  onWindow: (value: string) => void;
}) {
  if (!plan?.availability) return null;
  const today = georgiaDateISO();
  const latest = addCalendarDays(today, 6);
  const timeFields = (
    <ArrivalTimeFields
      idPrefix={idPrefix}
      hour={hour}
      minute={minute}
      meridiem={meridiem}
      summary={summary}
      onHour={onHour}
      onMinute={onMinute}
      onMeridiem={onMeridiem}
    />
  );
  if (plan.availability === "windows") {
    const open = plan.windows.filter((window) => windowIsOpen(window.ends_at));
    const selected = open.find((window) => window.id === windowId);
    return (
      <fieldset className="grid gap-3">
        <legend className="text-base font-semibold text-ink">Choose one pickup window</legend>
        <p className="text-base text-ink">Then choose the exact arrival time inside that window.</p>
        {open.length === 0 ? <p className="text-base text-ink">Those pickup windows have passed.</p> : null}
        {open.map((window) => (
          <label key={window.id} className="flex min-h-12 items-center gap-3 rounded-2xl bg-paper px-3 ring-1 ring-line">
            <input
              type="radio"
              name={`windows-${open[0]?.id ?? "pickup"}`}
              checked={windowId === window.id}
              onChange={() => onWindow(window.id)}
              className="size-5"
            />
            <span>{formatScheduledPickup(window.starts_at, window.ends_at)}</span>
          </label>
        ))}
        {selected ? timeFields : null}
      </fieldset>
    );
  }
  return (
    <div className="grid gap-3">
      <p className="text-base text-ink">
        {plan.availability === "asap"
          ? "Enter your earliest realistic pickup date and arrival time. This does not promise an immediate pickup."
          : "Propose a pickup date and arrival time. Do not arrive unannounced."}{" "}
        The arrival has to be at least {arrivalLeadMinutes} minutes from now.
      </p>
      <label className="text-base font-semibold text-ink" htmlFor={`${idPrefix}-date`}>
        Pickup date
        <input
          id={`${idPrefix}-date`}
          type="date"
          min={today}
          max={latest}
          value={date}
          onChange={(event) => onDate(event.target.value)}
          className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4"
        />
      </label>
      {timeFields}
    </div>
  );
}
