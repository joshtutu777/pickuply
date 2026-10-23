"use client";

import { useEffect } from "react";
import { recordFunnel } from "@/lib/funnel";

export function QuoteViewed({ service }: { service: string }) {
  useEffect(() => {
    void recordFunnel({ event: "quote_viewed", step: "viewed", service, pricing: "quote" });
  }, [service]);
  return null;
}
