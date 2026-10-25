"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Refetch customer offer counts when an offer changes. A late refresh cannot replace a newer one. */
export function CustomerOfferWatch() {
  const router = useRouter();
  const generation = useRef(0);

  useEffect(() => {
    let timer = 0;
    const refresh = () => {
      const token = ++generation.current;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (token !== generation.current) return;
        router.refresh();
      }, 400);
    };
    const supabase = createClient();
    const channel = supabase
      .channel("customer-offer-counts")
      .on("postgres_changes", { event: "*", schema: "public", table: "job_offers" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "offer_views" }, refresh)
      .subscribe();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 20000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
