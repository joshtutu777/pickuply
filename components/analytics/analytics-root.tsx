"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  analyticsCookieNames,
  claimEvent,
  analyticsOpen,
  containerId,
  conversionEvents,
  gtmScriptUrl,
  nextPageView,
  pagePath,
  sanitizeFields,
  shouldLoadTagManager,
  type ConsentChoice,
  type ConversionPush,
  type TrackingEvent,
} from "@/lib/analytics/tracking";
import { createClient } from "@/lib/supabase/client";
import { recordLandingLoad } from "@/lib/analytics/landing-load-client";
import { clearLeadTouch, recordLeadStage } from "@/lib/analytics/lead-collect";

const consentKey = "pickuply-analytics-consent";
const seenKey = "pickuply-analytics-seen";

type Gate = { consent: ConsentChoice | null; isTest: boolean; ready: boolean };

const gate: Gate = { consent: null, isTest: false, ready: false };
const seen = new Set<string>();
const listeners = new Set<() => void>();
let loaded = false;
let lastPath: string | null = null;
let requestSettings: (() => void) | null = null;

export function openCookieSettings() {
  requestSettings?.();
}

export function trackingDecision(): "send" | "skip" | "wait" {
  return analyticsOpen({ ready: gate.ready, consent: gate.consent, isTest: gate.isTest });
}

/** First-party visit steps are recorded for real visitors. Test profiles and signed-out loading are skipped. */
export function internalLeadAllowed(): boolean {
  return gate.ready && !gate.isTest;
}

export function subscribeTracking(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyTracking() {
  for (const listener of listeners) listener();
}

function readConsent(): ConsentChoice | null {
  try {
    const value = localStorage.getItem(consentKey);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

function readSeen() {
  try {
    const raw = localStorage.getItem(seenKey);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(ids)) return;
    for (const id of ids) if (typeof id === "string") seen.add(id);
  } catch {
    return;
  }
}

function writeSeen() {
  localStorage.setItem(seenKey, JSON.stringify([...seen].slice(-200)));
}

function dataLayer(): unknown[] {
  window.dataLayer = window.dataLayer ?? [];
  return window.dataLayer;
}

const deniedConsent = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
};

function gtagReady(): NonNullable<Window["gtag"]> {
  const layer = dataLayer();
  window.gtag =
    window.gtag ??
    function gtag() {
      // Google consent mode reads the arguments object from the data layer.
      layer.push(arguments);
    };
  return window.gtag;
}

function updateConsent(choice: ConsentChoice) {
  const gtag = gtagReady();
  gtag("consent", "default", { ...deniedConsent, wait_for_update: 500 });
  gtag("consent", "update", choice === "granted" ? {
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
    analytics_storage: "granted",
  } : deniedConsent);
}

function clearAnalyticsCookies() {
  const host = window.location.hostname;
  const domains = ["", host, host.includes(".") ? `.${host.split(".").slice(-2).join(".")}` : ""];
  for (const name of analyticsCookieNames(document.cookie)) {
    for (const domain of domains) {
      const domainPart = domain ? `; domain=${domain}` : "";
      document.cookie = `${name}=; Max-Age=0; path=/${domainPart}`;
    }
  }
}

function loadTagManager() {
  const id = containerId(process.env.NEXT_PUBLIC_GTM_ID);
  if (!id || !shouldLoadTagManager({ consent: gate.consent, isTest: gate.isTest, loaded })) return;
  loaded = true;
  updateConsent("granted");
  const script = document.createElement("script");
  script.async = true;
  script.src = gtmScriptUrl(id);
  script.dataset.gtm = id;
  script.onload = () => {
    if (gate.consent === "granted" && !gate.isTest) updateConsent("granted");
  };
  document.head.appendChild(script);
  dataLayer().push({ "gtm.start": Date.now(), event: "gtm.js" });
}

function canSend(): boolean {
  return trackingDecision() === "send";
}

export function pushTrackingEvent(
  event: TrackingEvent,
  key: string,
  fields: Record<string, unknown> = {},
  once = true,
): boolean {
  if (!canSend()) return false;
  if (once && !claimEvent(seen, key)) return false;
  if (once) writeSeen();
  updateConsent("granted");
  const payload = sanitizeFields(fields);
  dataLayer().push({ event, ...payload });
  return true;
}

export function pushConversion(conversion: ConversionPush, key: string): boolean {
  if (!canSend()) return false;
  if (!claimEvent(seen, key)) return false;
  writeSeen();
  updateConsent("granted");
  for (const payload of conversionEvents(conversion)) dataLayer().push(payload);
  return true;
}

export function AnalyticsRoot() {
  const pathname = usePathname();
  const [consent, setConsent] = useState<ConsentChoice | null>(null);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    readSeen();
    const stored = readConsent();
    setConsent(stored);
    gate.consent = stored;
    const supabase = createClient();
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        gate.isTest = false;
      } else {
        const profile = await supabase.from("profiles").select("is_test").eq("id", data.user.id).maybeSingle();
        gate.isTest = profile.data?.is_test === true;
      }
      gate.ready = true;
      setReady(true);
      notifyTracking();
    });
  }, []);

  useEffect(() => {
    requestSettings = () => setSettingsOpen(true);
    return () => {
      requestSettings = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    loadTagManager();
    const view = nextPageView(lastPath, pathname);
    if (!view || gate.consent !== "granted" || gate.isTest) return;
    lastPath = view.page_path;
    dataLayer().push(view);
  }, [pathname, ready, consent]);

  // Landing load counts run for every real visitor, with or without optional cookies.
  useEffect(() => {
    if (!ready || gate.isTest) return;
    void recordLandingLoad(window.location.href, document.referrer);
  }, [pathname, ready]);

  useEffect(() => {
    if (!ready || gate.isTest) return;
    const path = pagePath(pathname);
    if (path === "/") void recordLeadStage("landing_viewed");
    if (path === "/request") void recordLeadStage("request_viewed");
  }, [pathname, ready]);

  function choose(choice: ConsentChoice) {
    localStorage.setItem(consentKey, choice);
    gate.consent = choice;
    setConsent(choice);
    setSettingsOpen(false);
    if (choice === "denied") {
      updateConsent("denied");
      clearAnalyticsCookies();
      clearLeadTouch();
      notifyTracking();
      return;
    }
    loadTagManager();
    notifyTracking();
    const leadPath = pagePath(pathname);
    if (leadPath === "/") void recordLeadStage("landing_viewed");
    if (leadPath === "/request") void recordLeadStage("request_viewed");
    const path = pagePath(pathname);
    if (path && lastPath !== path) {
      lastPath = path;
      dataLayer().push({ event: "page_view", page_path: path });
    }
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

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}
