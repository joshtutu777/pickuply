"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function ReviewCountdown({ until }: { until: string }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [refreshed, setRefreshed] = useState(false);
  const remaining = new Date(until).getTime() - now;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (remaining > 0 || refreshed) return;
    setRefreshed(true);
    router.refresh();
  }, [refreshed, remaining, router]);

  if (remaining <= 0) return <p className="text-base text-ink">Pickup review is closing.</p>;
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return (
    <p className="text-base font-semibold text-ink">
      Time left to review: {minutes}:{rest}
    </p>
  );
}
