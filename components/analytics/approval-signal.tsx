"use client";

import { useEffect } from "react";
import { pushTrackingEvent } from "@/components/analytics/analytics-root";

export function ApprovalSignal({ driverId }: { driverId: string }) {
  useEffect(() => {
    pushTrackingEvent("driver_approved", `driver_approved:${driverId}`);
  }, [driverId]);
  return null;
}
