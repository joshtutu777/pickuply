"use client";

import { useEffect, useState } from "react";

export function UpdateBanner() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.pathname.includes("/pay")) return;
    const watch = (registration: ServiceWorkerRegistration) => {
      const next = registration.installing ?? registration.waiting;
      if (registration.waiting) setReady(true);
      next?.addEventListener("statechange", () => {
        if (next.state === "installed" && navigator.serviceWorker.controller) setReady(true);
      });
    };
    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      watch(registration);
      registration.addEventListener("updatefound", () => watch(registration));
    });
  }, []);

  if (!ready) return null;
  return (
    <div className="bg-ink px-4 py-3 text-white">
      <p className="text-base">New version available — Refresh</p>
      <button
        type="button"
        className="mt-2 inline-flex min-h-12 items-center font-semibold"
        onClick={() => {
          void navigator.serviceWorker.getRegistration().then((registration) => {
            registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
          });
          window.location.reload();
        }}
      >
        Refresh
      </button>
    </div>
  );
}
