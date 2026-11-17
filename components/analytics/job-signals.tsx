"use client";

import { useEffect } from "react";
import { bookingEvent, deliveryEvent, newOfferIds, purchaseConversion } from "@/lib/analytics/tracking";
import { pushConversion, pushTrackingEvent } from "@/components/analytics/analytics-root";

export function JobSignals({
  jobId,
  service,
  status,
  paymentStatus,
  totalCents,
  checkoutAttempt,
  live,
  isTest,
  returning,
  tracked,
  offers,
}: {
  jobId: string;
  service: string;
  status: string;
  paymentStatus: string | null;
  totalCents: number | null;
  checkoutAttempt: number;
  live: boolean;
  isTest: boolean;
  returning: boolean;
  tracked: string | null;
  offers: { offer_id: string; viewed?: boolean }[];
}) {
  useEffect(() => {
    const booking = bookingEvent({ returning, paymentStatus, isTest });
    if (booking) pushTrackingEvent(booking.event, `${booking.event}:${jobId}`);
    const delivery = deliveryEvent({ tracked, status, isTest });
    if (delivery) pushTrackingEvent(delivery.event, `${delivery.event}:${jobId}`);
    void purchaseConversion({
      jobId,
      attempt: checkoutAttempt,
      service,
      paymentStatus,
      totalCents,
      live,
      isTest,
    }).then((purchase) => {
      if (purchase) pushConversion(purchase, purchase.eventId);
    });
    if (!isTest && tracked === "offer") pushTrackingEvent("offer_accepted", `offer_accepted:${jobId}`);
    if (!isTest) {
      for (const offerId of newOfferIds(offers)) {
        pushTrackingEvent("offer_received", `offer_received:${offerId}`);
      }
    }
  }, [checkoutAttempt, isTest, jobId, live, offers, paymentStatus, returning, service, status, totalCents, tracked]);

  return null;
}
