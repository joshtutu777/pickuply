"use client";

import { useEffect } from "react";

export function AppBadge({ count }: { count: number }) {
  useEffect(() => {
    const badge = navigator as Navigator & { setAppBadge?: (value?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (count > 0 && badge.setAppBadge) void badge.setAppBadge(count).catch(() => undefined);
    if (count === 0 && badge.clearAppBadge) void badge.clearAppBadge().catch(() => undefined);
  }, [count]);
  return null;
}
