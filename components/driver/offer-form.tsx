"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pushTrackingEvent } from "@/components/analytics/analytics-root";
import { offerBreakdown, type FeeSettings } from "@/lib/fees";
import { offerButtonLabel, offerDraftReady, offerFieldLabel } from "@/lib/driver/feed-card";
import { offerMaySubmit, showOfflineOfferNotice } from "@/lib/driver/offer-gate";
import { recordFunnel } from "@/lib/funnel";
import { flushTexts } from "@/lib/notifications/flush-client";
import { takenJobMessage } from "@/lib/jobs/taken-message";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";

export type OfferJob = {
  id: string;
  service: string;
  pricing_method: string;
  offer_cents: number | null;
  driver_pay_cents: number | null;
};

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

export function OfferForm({
  job,
  approved,
  online,
  vehicleOk,
  blockedReason,
  fees,
  onDone,
  onGoOnline,
}: {
  job: OfferJob;
  approved: boolean;
  online: boolean;
  vehicleOk: boolean;
  blockedReason: string | null;
  fees: FeeSettings;
  onDone: () => void;
  onGoOnline: () => Promise<{ online: boolean; error: string | null }>;
}) {
  const [amount, setAmount] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [message, setMessage] = useState<{ text: string; alert: boolean } | null>(null);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [goingOnline, setGoingOnline] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const offerCents = parseDollarsToCents(amount) ?? 0;
  const claimable = job.pricing_method === "quote" && job.driver_pay_cents != null;
  const driverQuote = job.pricing_method === "quote" && !claimable;
  const posted = job.pricing_method === "fixed" ? job.offer_cents : null;
  const maySubmit = offerMaySubmit({ online, approved, vehicleOk });
  const showOffline = showOfflineOfferNotice({ online, approved });

  function holdForOnline() {
    noticeRef.current?.scrollIntoView({ block: "start" });
    noticeRef.current?.focus();
  }

  async function becomeOnline() {
    setGoingOnline(true);
    setOnlineError(null);
    const result = await onGoOnline();
    setGoingOnline(false);
    if (!result.online) setOnlineError(result.error ?? "You are still Offline.");
  }

  async function send(kind: "accept" | "claim" | "offer") {
    if (!maySubmit) {
      if (showOffline) holdForOnline();
      return;
    }
    setMessage(null);
    const supabase = createClient();
    const result =
      kind === "claim"
        ? await supabase.rpc("claim_job", { target_job: job.id })
        : await supabase.rpc("submit_offer", {
            target_job: job.id,
            kind,
            earnings_cents: kind === "accept" ? null : offerCents,
            reason: "",
          });
    if (result.error) {
      setMessage({ text: takenJobMessage(result.error.message), alert: true });
      return;
    }
    const submitted = kind === "offer" || kind === "accept" ? offerBreakdown(kind === "accept" ? posted ?? 0 : offerCents, fees) : null;
    setReviewing(false);
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
    flushTexts();
    if (kind === "offer") pushTrackingEvent("driver_offer_submitted", `driver_offer_submitted:${job.id}`, { service: job.service });
    if (kind === "accept") pushTrackingEvent("driver_offer_accepted", `driver_offer_accepted:${job.id}`, { service: job.service });
    if (kind === "claim") router.refresh();
    onDone();
  }

  return (
    <div className="grid gap-3">
      {showOffline ? (
        <div ref={noticeRef} tabIndex={-1} role="alert" className="rounded-2xl bg-paper p-3 ring-1 ring-line">
          <p className="font-semibold text-ink">You&apos;re currently offline. Go online to submit an offer.</p>
          <button
            type="button"
            disabled={goingOnline}
            onClick={() => void becomeOnline()}
            className="mt-3 inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-5 font-semibold text-white disabled:opacity-60"
          >
            Go Online
          </button>
          {onlineError ? <p className="mt-2 text-base text-danger">{onlineError}</p> : null}
        </div>
      ) : null}
      {claimable ? (
        <button
          type="button"
          disabled={!approved || !vehicleOk}
          onClick={() => void send("claim")}
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand font-semibold text-white disabled:opacity-60"
        >
          Claim this job
        </button>
      ) : (
        <>
          {posted != null ? (
            <>
              <OfferMath cents={posted} settings={fees} />
              <button
                type="button"
                disabled={!approved || !vehicleOk}
                onClick={() => void send("accept")}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-brand font-semibold text-white disabled:opacity-60"
              >
                Accept posted price
              </button>
            </>
          ) : null}
          <label className="text-base font-semibold text-ink" htmlFor={`offer-${job.id}`}>
            {offerFieldLabel}
            <input
              id={`offer-${job.id}`}
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setReviewing(false);
              }}
              onFocus={(event) => {
                const field = event.currentTarget;
                window.setTimeout(() => field.scrollIntoView({ block: "center" }), 250);
              }}
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4 text-base"
            />
          </label>
          <OfferMath cents={offerCents} settings={fees} />
          {reviewing ? (
            <div className="grid gap-3 rounded-2xl bg-paper p-3 ring-1 ring-line">
              <p className="font-semibold">{driverQuote ? "Confirm this quote" : "Confirm this offer"}</p>
              <OfferMath cents={offerCents} settings={fees} />
              <button
                type="button"
                disabled={!approved || !vehicleOk}
                onClick={() => void send("offer")}
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand font-semibold text-white disabled:opacity-60"
              >
                {driverQuote ? "Send quote" : "Confirm offer"}
              </button>
              <button type="button" onClick={() => setReviewing(false)} className="inline-flex min-h-12 items-center font-semibold text-brand">
                Edit offer
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={!approved || !vehicleOk || !offerDraftReady(offerCents)}
              onClick={() => {
                if (!maySubmit) {
                  holdForOnline();
                  return;
                }
                setReviewing(true);
              }}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-4 font-semibold text-white disabled:opacity-60"
            >
              {offerButtonLabel}
            </button>
          )}
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
