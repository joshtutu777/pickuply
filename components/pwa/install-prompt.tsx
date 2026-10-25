"use client";

import { useSyncExternalStore } from "react";
import { installCopy, showInstallPrompt } from "@/lib/pwa/install";

const dismissKey = "pickuply.install-dismissed";

function readDismissed(): string | null {
  try {
    return localStorage.getItem(dismissKey);
  } catch {
    return null;
  }
}

export function InstallPrompt({ audience, hasRequest = false }: { audience: "driver" | "customer"; hasRequest?: boolean }) {
  const visible = useSyncExternalStore(
    () => () => undefined,
    () => {
      const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      return showInstallPrompt({
        installed,
        dismissedAt: readDismissed(),
        now: new Date().toISOString(),
        audience,
        hasRequest,
      });
    },
    () => false,
  );
  if (!visible) return null;
  const copy = installCopy({
    userAgent: navigator.userAgent,
    installed: false,
    ios: /iPhone|iPad/.test(navigator.userAgent),
  });
  return (
    <section className={audience === "driver" ? "mt-4 rounded-3xl bg-brand p-4 text-white" : "mt-4 rounded-3xl bg-paper-raised p-4 text-ink ring-1 ring-line"}>
      <h2 className="text-lg font-semibold">{audience === "driver" ? "Install Pickuply to get job alerts" : "Install Pickuply"}</h2>
      <p className="mt-2 text-base">{copy}</p>
      <button
        type="button"
        className="mt-3 inline-flex min-h-12 items-center font-semibold underline"
        onClick={() => {
          localStorage.setItem(dismissKey, new Date().toISOString());
          window.location.reload();
        }}
      >
        Not now
      </button>
    </section>
  );
}
