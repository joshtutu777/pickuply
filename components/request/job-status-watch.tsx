"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const paid = new Set(["authorized", "paid", "captured"]);

/** Reload this job when its status or payment changes, including a card authorization. */
export function JobStatusWatch({
  jobId,
  status,
  paymentStatus,
}: {
  jobId: string;
  status: string;
  paymentStatus: string | null;
}) {
  const router = useRouter();
  const seen = useRef(status);
  const seenPayment = useRef(paymentStatus ?? "");
  const waiting = useRef(status === "assigned" && !paid.has(paymentStatus ?? ""));
  const rechecks = useRef(0);

  useEffect(() => {
    seen.current = status;
    seenPayment.current = paymentStatus ?? "";
    waiting.current = status === "assigned" && !paid.has(paymentStatus ?? "");
    if (!waiting.current) rechecks.current = 0;
  }, [paymentStatus, status]);

  useEffect(() => {
    const supabase = createClient();
    let timer = 0;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => router.refresh(), 300);
    };
    const check = async () => {
      const { data } = await supabase.from("jobs").select("status, payment_status").eq("id", jobId).maybeSingle();
      if (!data?.status) return;
      const nextPayment = data.payment_status ?? "";
      if (data.status === seen.current && nextPayment === seenPayment.current) {
        if (waiting.current && document.visibilityState === "visible" && rechecks.current < 30) {
          rechecks.current += 1;
          refresh();
        }
        return;
      }
      seen.current = data.status;
      seenPayment.current = nextPayment;
      waiting.current = data.status === "assigned" && !paid.has(nextPayment);
      refresh();
    };
    const channel = supabase
      .channel(`job-status-${jobId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${jobId}` },
        refresh,
      )
      .subscribe();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, 4000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
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
  }, [jobId, router]);

  return null;
}
