"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AdminAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let timer = 0;
    let generation = 0;
    const refresh = () => {
      const token = ++generation;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (token !== generation) return;
        router.refresh();
      }, 400);
    };
    const poll = window.setInterval(refresh, 30_000);
    const supabase = createClient();
    const channel = supabase
      .channel("admin-offers")
      .on("postgres_changes", { event: "*", schema: "public", table: "job_offers" }, refresh)
      .subscribe();
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [router]);
  return null;
}

export function AdminDocumentTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = title;
  }, [title]);
  return null;
}

export function RefreshButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-paper-raised px-5 text-base font-semibold text-ink"
    >
      Refresh
    </button>
  );
}
