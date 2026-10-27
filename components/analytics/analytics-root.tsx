"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const consentKey = "pickuply-analytics-consent";
type ConsentChoice = "granted" | "denied";

let requestSettings: (() => void) | null = null;

export function openCookieSettings() {
  requestSettings?.();
}

function readConsent(): ConsentChoice | null {
  try {
    const value = localStorage.getItem(consentKey);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

/** Cookie choice only. Tag Manager stays out of this release. */
export function AnalyticsRoot() {
  const [consent, setConsent] = useState<ConsentChoice | null>(null);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setConsent(readConsent());
    const supabase = createClient();
    void supabase.auth.getUser().then(() => setReady(true));
  }, []);

  useEffect(() => {
    requestSettings = () => setSettingsOpen(true);
    return () => {
      requestSettings = null;
    };
  }, []);

  function choose(choice: ConsentChoice) {
    localStorage.setItem(consentKey, choice);
    setConsent(choice);
    setSettingsOpen(false);
  }

  if (!ready || (consent && !settingsOpen)) return null;
  return (
    <section
      role="dialog"
      aria-labelledby="analytics-consent-title"
      className="relative z-20 mx-auto mt-[max(0.5rem,env(safe-area-inset-top))] mb-2 w-[calc(100%-1.5rem)] max-h-[40vh] max-w-xl overflow-y-auto rounded-2xl bg-paper-raised p-3 ring-1 ring-line"
    >
      <p id="analytics-consent-title" className="text-base font-semibold text-ink">Optional cookies</p>
      <p className="mt-2 text-base text-muted">
        Allow analytics and advertising cookies, or reject them. Sign-in cookies stay on either way.{" "}
        <Link href="/privacy" className="font-semibold text-brand">Privacy policy</Link>
      </p>
      <div className="mt-3 grid gap-2">
        <button type="button" className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-brand px-4 font-semibold text-white" onClick={() => choose("granted")}>
          Allow optional cookies
        </button>
        <button type="button" className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-4 font-semibold text-brand ring-1 ring-line" onClick={() => choose("denied")}>
          Reject optional cookies
        </button>
      </div>
    </section>
  );
}
