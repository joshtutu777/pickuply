"use client";

import { useSyncExternalStore } from "react";
import { dismissHomeScreenHint } from "@/app/account/notification-actions";

function subscribe(): () => void {
  return () => undefined;
}

function showHint(dismissed: boolean): boolean {
  const apple = /iPhone|iPad/.test(navigator.userAgent);
  const installed = window.matchMedia("(display-mode: standalone)").matches;
  return !dismissed && apple && !installed;
}

export function HomeScreenHint({ dismissed }: { dismissed: boolean }) {
  const visible = useSyncExternalStore(subscribe, () => showHint(dismissed), () => false);
  if (!visible) return null;

  return (
    <section className="mt-4 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <h2 className="text-lg font-semibold text-ink">Add Pickuply to your Home Screen to get alerts</h2>
      <p className="mt-2 text-base text-muted">
        Tap Share, then Add to Home Screen. Open Pickuply from that icon and turn alerts on.
      </p>
      <form action={dismissHomeScreenHint} className="mt-3">
        <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-brand">
          Got it
        </button>
      </form>
    </section>
  );
}
