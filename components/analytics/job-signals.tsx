"use client";

import { useEffect } from "react";
import { bookingEvent, deliveryEvent, purchaseEvent } from "@/lib/analytics/tracking";
import { pushTrackingEvent } from "@/components/analytics/analytics-root";

export function JobSignals({
  jobId,
  status,
  paymentStatus,
  capturedCents,
  live,
  isTest,
  returning,
  tracked,
  offerIds,
}: {
  jobId: string;
  status: string;
  paymentStatus: string | null;
  capturedCents: number | null;
  live: boolean;
  isTest: boolean;
  returning: boolean;
  tracked: string | null;
  offerIds: string[];
}) {
  useEffect(() => {
    const booking = bookingEvent({ returning, paymentStatus, isTest });
    if (booking) pushTrackingEvent(booking.event, `${booking.event}:${jobId}`);
    const delivery = deliveryEvent({ tracked, status, isTest });
    if (delivery) pushTrackingEvent(delivery.event, `${delivery.event}:${jobId}`);
    const purchase = purchaseEvent({ tracked, paymentStatus, capturedCents, live, isTest });
    if (purchase) pushTrackingEvent(purchase.event, `${purchase.event}:${jobId}`, { value: purchase.value, currency: purchase.currency });
    if (!isTest && tracked === "offer") pushTrackingEvent("offer_accepted", `offer_accepted:${jobId}`);
    if (!isTest) {
      for (const offerId of offerIds) {
        if (/^[0-9a-f-]{36}$/i.test(offerId)) pushTrackingEvent("offer_received", `offer_received:${offerId}`);
      }
    }
  }, [capturedCents, isTest, jobId, live, offerIds, paymentStatus, returning, status, tracked]);

  return null;
}
