"use client";

import { useSyncExternalStore } from "react";
import { waitedLabel } from "@/lib/admin/ops";

function emptySubscribe(): () => void {
  return () => undefined;
}

let shownAt = 0;

function shownAtSnapshot(): number {
  if (shownAt === 0) shownAt = new Date().getTime();
  return shownAt;
}

export function LastUpdate({ iso }: { iso: string }) {
  const now = useSyncExternalStore(emptySubscribe, shownAtSnapshot, () => 0);
  if (now === 0) return null;
  return <p className="mb-3 text-sm text-muted">Last update {waitedLabel(iso, now)}</p>;
}
