"use client";

import { useEffect, useState } from "react";
import { reviewRequest } from "@/app/admin/requests/actions";
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

export function ReviewRequestForm({
  jobId,
  zones,
  pricingMethod,
  needsConfirm,
}: {
  jobId: string;
  zones: { id: string; name: string }[];
  pricingMethod: string;
  needsConfirm: boolean;
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

  return (
    <form action={reviewRequest} className="mt-8 space-y-4">
      <input type="hidden" name="jobId" value={jobId} />
      <label className="block text-base font-semibold text-ink" htmlFor="zoneId">
        Zone
        <select id="zoneId" name="zoneId" className={controlClass} required>
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
            Driver pay (dollars)
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
              <p>Driver pay {formatCents(shown.driver_earnings_cents)}</p>
              <p>Platform fee {formatCents(shown.platform_fee_cents)}</p>
              <p>Subtotal {formatCents(shown.subtotal_cents)}</p>
              <p>Service fee {formatCents(shown.service_fee_cents)}</p>
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
      <label className="block text-base font-semibold text-ink" htmlFor="note">
        Note for the customer
        <textarea id="note" name="note" className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-paper-raised px-4 py-3" />
      </label>
      <div className="grid gap-3">
        {pricingMethod === "quote" ? (
          <SubmitButton action="quote" label="Send quote" />
        ) : (
          <SubmitButton action="publish" label="Approve and publish" />
        )}
        <SubmitButton action="changes" label="Request changes" />
        <SubmitButton action="decline" label="Decline" />
      </div>
    </form>
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
