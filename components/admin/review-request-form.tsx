"use client";

import { useEffect, useState } from "react";
import { askForDetails, reviewRequest } from "@/app/admin/requests/actions";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";

type Breakdown = {
  driver_earnings_cents: number;
  platform_fee_cents: number;
  subtotal_cents: number;
  service_fee_cents: number;
  customer_total_cents: number;
};

const controlClass =
  "mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4 text-base text-ink";

const detailChoices = [
  ["stairs", "Stairs"],
  ["size", "Item size"],
  ["pieces", "Number of pieces"],
  ["item_value", "Item value"],
  ["access_notes", "Access notes"],
  ["photos", "More photos"],
] as const;

export function ReviewRequestForm({
  jobId,
  pricingMethod,
  needsConfirm,
  detailsOpen = false,
  paused = false,
  askOnly = false,
  zones,
}: {
  jobId: string;
  pricingMethod: string;
  needsConfirm: boolean;
  detailsOpen?: boolean;
  paused?: boolean;
  askOnly?: boolean;
  zones: { id: string; name: string }[];
}) {
  const [driverPay, setDriverPay] = useState("");
  const [breakdown, setBreakdown] = useState<{ cents: number; body: Breakdown } | null>(null);
  const cents = parseDollarsToCents(driverPay);
  const shown = breakdown && breakdown.cents === cents ? breakdown.body : null;

  useEffect(() => {
    if (!cents || cents <= 0) return;
    let cancelled = false;
    void createClient()
      .rpc("price_breakdown", { mode: "forward", amount_cents: cents })
      .then(({ data }) => {
        if (!cancelled && data) setBreakdown({ cents, body: data as Breakdown });
      });
    return () => {
      cancelled = true;
    };
  }, [cents]);

  const waiting = detailsOpen ? (
    <p className="rounded-2xl bg-paper-raised p-4 text-base ring-1 ring-line">
      {paused
        ? "Waiting on the customer. Drivers cannot see this request until they update it."
        : pricingMethod === "quote"
          ? "Waiting on the customer. Drivers cannot see this quote until you send a price and the customer accepts it."
          : "Waiting on the customer. Drivers can still see this request and send offers."}
    </p>
  ) : null;

  const askForm = detailsOpen ? null : (
    <form action={askForDetails} className="mt-6 space-y-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <h2 className="text-lg font-semibold text-ink">Ask for details</h2>
      <input type="hidden" name="jobId" value={jobId} />
      <fieldset className="space-y-2">
        <legend className="text-base font-semibold text-ink">What do you need?</legend>
        {detailChoices.map(([value, label]) => (
          <label key={value} className="flex min-h-12 items-center gap-3 text-base">
            <input type="checkbox" name="item" value={value} />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="block text-base font-semibold text-ink" htmlFor="detail-note">
        Note for the customer
        <textarea id="detail-note" name="note" className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-paper px-4 py-3" />
      </label>
      <label className="flex min-h-12 items-start gap-3 text-base">
        <input className="mt-1" type="checkbox" name="pauseUntilUpdated" />
        <span>
          Pause until updated
          <span className="mt-1 block text-sm font-normal text-muted">
            {pricingMethod === "quote"
              ? "Drivers still will not see this quote until you send a price and the customer accepts it."
              : "Drivers will not see this request until the customer updates it. Leave this off to keep it visible."}
          </span>
        </span>
      </label>
      <button
        type="submit"
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
      >
        Ask for details
      </button>
    </form>
  );

  if (askOnly) {
    return (
      <>
        {waiting}
        {askForm}
      </>
    );
  }

  return (
    <>
    <form action={reviewRequest} className="mt-8 space-y-4">
      <input type="hidden" name="jobId" value={jobId} />
      <label className="block text-base font-semibold text-ink" htmlFor="zoneId">
        Zone
        <select id="zoneId" name="zoneId" className={controlClass} defaultValue="">
          <option value="">Choose a zone</option>
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-base font-semibold text-ink" htmlFor="serviceLevel">
        Service level
        <select id="serviceLevel" name="serviceLevel" className={controlClass}>
          <option value="light">Light</option>
          <option value="full">Full</option>
        </select>
      </label>
      <label className="block text-base font-semibold text-ink" htmlFor="requiredVehicle">
        Required vehicle
        <select id="requiredVehicle" name="requiredVehicle" className={controlClass}>
          <option value="pickup">Pickup</option>
          <option value="van">Van</option>
          <option value="suv">SUV</option>
          <option value="car">Car</option>
          <option value="box_truck">Box truck</option>
          <option value="trailer">Trailer</option>
        </select>
      </label>
      <label className="block text-base font-semibold text-ink" htmlFor="dumpFee">
        Dump fee (dollars)
        <input id="dumpFee" name="dumpFee" defaultValue="0" inputMode="decimal" className={controlClass} />
      </label>
      {needsConfirm ? (
        <label className="flex min-h-12 items-start gap-3 text-base">
          <input className="mt-1" type="checkbox" name="highValueOk" />
          I reviewed this high-value or specialty item (piano, safe, pool table, hot tub, or gun safe).
        </label>
      ) : null}
      {pricingMethod === "quote" ? (
        <>
          <label className="block text-base font-semibold text-ink" htmlFor="driverPay">
            Customer offer (dollars)
            <input
              id="driverPay"
              name="driverPay"
              value={driverPay}
              onChange={(event) => setDriverPay(event.target.value)}
              inputMode="decimal"
              className={controlClass}
            />
          </label>
          {shown ? (
            <div className="rounded-2xl bg-paper-raised p-4 text-base ring-1 ring-line">
              <p>Offer {formatCents(shown.subtotal_cents)}</p>
              <p>Pickuply commission {formatCents(shown.platform_fee_cents)}</p>
              <p>Driver earnings {formatCents(shown.driver_earnings_cents)}</p>
              <p>Card processing fee {formatCents(shown.service_fee_cents)}</p>
              <p className="font-semibold">Customer total {formatCents(shown.customer_total_cents)}</p>
            </div>
          ) : null}
          <label className="block text-base font-semibold text-ink" htmlFor="preferredDate">
            Pickup date
            <input id="preferredDate" name="preferredDate" className={controlClass} placeholder="YYYY-MM-DD" />
          </label>
          <label className="block text-base font-semibold text-ink" htmlFor="timeWindow">
            Pickup window
            <select id="timeWindow" name="timeWindow" className={controlClass}>
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
              <option value="evening">Evening</option>
            </select>
          </label>
          <label className="block text-base font-semibold text-ink" htmlFor="expiresHours">
            Quote expires in hours
            <input id="expiresHours" name="expiresHours" defaultValue="24" inputMode="numeric" className={controlClass} />
          </label>
        </>
      ) : null}
      <label className="block text-base font-semibold text-ink" htmlFor="decline-note">
        Reason if you decline
        <textarea id="decline-note" name="note" className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-paper-raised px-4 py-3" />
      </label>
      {detailsOpen ? waiting : pricingMethod === "quote" ? (
        <div className="grid gap-3">
          <SubmitButton action="quote" label="Send quote" />
        </div>
      ) : null}
      <SubmitButton action="decline" label="Decline" />
    </form>
    {askForm}
    </>
  );
}

function SubmitButton({ action, label }: { action: string; label: string }) {
  return (
    <button
      type="submit"
      name="action"
      value={action}
      className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
    >
      {label}
    </button>
  );
}
