"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  analyticsCookieNames,
  claimEvent,
  containerId,
  gtmScriptUrl,
  nextPageView,
  pagePath,
  sanitizeFields,
  shouldLoadTagManager,
  type ConsentChoice,
  type TrackingEvent,
} from "@/lib/analytics/tracking";
import { createClient } from "@/lib/supabase/client";

const consentKey = "pickuply-analytics-consent";
const seenKey = "pickuply-analytics-seen";

type Gate = { consent: ConsentChoice | null; isTest: boolean; ready: boolean };

const gate: Gate = { consent: null, isTest: false, ready: false };
const seen = new Set<string>();
let loaded = false;
let lastPath: string | null = null;

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
  document.head.appendChild(script);
  dataLayer().push({ "gtm.start": Date.now(), event: "gtm.js" });
}

export function pushTrackingEvent(
  event: TrackingEvent,
  key: string,
  fields: Record<string, unknown> = {},
  once = true,
): boolean {
  if (!gate.ready || gate.consent !== "granted" || gate.isTest) return false;
  if (once && !claimEvent(seen, key)) return false;
  if (once) writeSeen();
  const payload = sanitizeFields(fields);
  dataLayer().push({ event, ...payload });
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
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    loadTagManager();
    const view = nextPageView(lastPath, pathname);
    if (!view || gate.consent !== "granted" || gate.isTest) return;
    lastPath = view.page_path;
    dataLayer().push(view);
  }, [pathname, ready, consent]);

  function choose(choice: ConsentChoice) {
    localStorage.setItem(consentKey, choice);
    gate.consent = choice;
    setConsent(choice);
    setSettingsOpen(false);
    if (choice === "denied") {
      updateConsent("denied");
      clearAnalyticsCookies();
      return;
    }
    loadTagManager();
    const path = pagePath(pathname);
    if (path && lastPath !== path) {
      lastPath = path;
      dataLayer().push({ event: "page_view", page_path: path });
    }
  }

  if (!ready) return null;
  if (consent && !settingsOpen) {
    return (
      <button
        type="button"
        className="fixed bottom-3 left-3 z-40 inline-flex min-h-12 items-center rounded-full bg-paper-raised px-4 text-sm font-semibold text-ink ring-1 ring-line"
        onClick={() => setSettingsOpen(true)}
      >
        Cookie settings
      </button>
    );
  }
  return (
    <div role="dialog" aria-labelledby="analytics-consent-title" className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-xl rounded-3xl bg-paper-raised p-4 shadow-lg ring-1 ring-line">
      <p id="analytics-consent-title" className="text-base font-semibold text-ink">Optional cookies</p>
      <p className="mt-2 text-base text-muted">
        Allow analytics and advertising cookies, or reject them. Sign-in cookies stay on either way.{" "}
        <Link href="/privacy" className="font-semibold text-brand">Privacy policy</Link>
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className="inline-flex min-h-12 items-center rounded-2xl bg-brand px-4 font-semibold text-white" onClick={() => choose("granted")}>
          Allow optional cookies
        </button>
        <button type="button" className="inline-flex min-h-12 items-center rounded-2xl px-4 font-semibold text-brand ring-1 ring-line" onClick={() => choose("denied")}>
          Reject optional cookies
        </button>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}
