"use client";

import { openCookieSettings } from "@/components/analytics/analytics-root";

export function CookieSettingsLink({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => openCookieSettings()}>
      Cookie settings
    </button>
  );
}
