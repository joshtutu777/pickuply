"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import {
  analyticsCookieNames,
  consentState,
  consentStorageKey,
  containerId,
  gtmScriptUrl,
  shouldLoadTagManager,
  storedConsent,
  type ConsentChoice,
  type ConsentState,
} from "@/lib/analytics/tracking";
import { createClient } from "@/lib/supabase/client";

type Gate = {
  consent: ConsentChoice | null;
  isTest: boolean;
  ready: boolean;
  settingsOpen: boolean;
};

function readStoredConsent(): ConsentChoice | null {
  try {
    if (typeof window === "undefined") return null;
    return storedConsent(window.localStorage.getItem(consentStorageKey));
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
let loaded = false;
let gate: Gate = {
  consent: readStoredConsent(),
  isTest: false,
  ready: false,
  settingsOpen: false,
};

function emit() {
  for (const listener of listeners) listener();
}

function publish(next: Partial<Gate>) {
  gate = { ...gate, ...next };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return gate;
}

const serverSnapshot: Gate = { consent: null, isTest: false, ready: false, settingsOpen: false };

function getServerSnapshot(): Gate {
  return serverSnapshot;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

function dataLayer(): unknown[] {
  window.dataLayer = window.dataLayer ?? [];
  return window.dataLayer;
}

function gtagReady(): NonNullable<Window["gtag"]> {
  const layer = dataLayer();
  window.gtag =
    window.gtag ??
    function gtag() {
      // Google consent mode reads the arguments object, not a rest array.
      // eslint-disable-next-line prefer-rest-params
      layer.push(arguments);
    };
  return window.gtag;
}

function applyConsent(choice: ConsentChoice) {
  const gtag = gtagReady();
  const state: ConsentState = consentState(choice);
  gtag("consent", "default", { ...consentState("denied"), wait_for_update: 500 });
  gtag("consent", "update", state);
  if (choice === "denied" && window.fbq) window.fbq("consent", "revoke");
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
  dataLayer().push({ "gtm.start": Date.now(), event: "gtm.js" });
  const script = document.createElement("script");
  script.async = true;
  script.src = gtmScriptUrl(id);
  script.dataset.gtm = id;
  document.head.appendChild(script);
}

export function openCookieSettings() {
  publish({ settingsOpen: true });
}

export function trackTipPurchase(transactionId: string, value: number) {
  if (gate.consent !== "granted" || gate.isTest) return;
  gtagReady()("event", "purchase", {
    transaction_id: transactionId,
    value,
    currency: "USD",
  });
  const sendPixel = () => {
    window.fbq?.("track", "Purchase", { value, currency: "USD" }, { eventID: transactionId });
  };
  if (window.fbq) {
    sendPixel();
    return;
  }
  let tries = 0;
  const timer = window.setInterval(() => {
    tries += 1;
    if (!window.fbq && tries <= 20) return;
    window.clearInterval(timer);
    if (gate.consent === "granted" && window.fbq) sendPixel();
  }, 250);
}

export function AnalyticsRoot() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        let isTest = false;
        if (data.user) {
          const profile = await supabase.from("profiles").select("is_test").eq("id", data.user.id).maybeSingle();
          isTest = profile.data?.is_test === true;
        }
        if (!cancelled) publish({ ready: true, isTest });
      } catch {
        if (!cancelled) publish({ ready: true, isTest: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!snapshot.ready || snapshot.isTest || !snapshot.consent) return;
    applyConsent(snapshot.consent);
    if (snapshot.consent === "denied") clearAnalyticsCookies();
    if (snapshot.consent === "granted") loadTagManager();
  }, [snapshot.ready, snapshot.consent, snapshot.isTest]);

  function choose(choice: ConsentChoice) {
    try {
      localStorage.setItem(consentStorageKey, choice);
    } catch {
      // The choice still applies for this visit when the browser blocks storage.
    }
    publish({ consent: choice, settingsOpen: false });
    if (snapshot.isTest) return;
    applyConsent(choice);
    if (choice === "denied") {
      clearAnalyticsCookies();
      return;
    }
    loadTagManager();
  }

  if (!snapshot.ready || (snapshot.consent && !snapshot.settingsOpen)) return null;
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
