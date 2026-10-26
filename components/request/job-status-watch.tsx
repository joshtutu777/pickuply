"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Reload this job when its status changes, including a driver delivery update. */
export function JobStatusWatch({ jobId, status }: { jobId: string; status: string }) {
  const router = useRouter();
  const seen = useRef(status);

  useEffect(() => {
    seen.current = status;
  }, [status]);

  useEffect(() => {
    const supabase = createClient();
    let timer = 0;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => router.refresh(), 300);
    };
    const check = async () => {
      const { data } = await supabase.from("jobs").select("status").eq("id", jobId).maybeSingle();
      if (!data?.status || data.status === seen.current) return;
      seen.current = data.status;
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
