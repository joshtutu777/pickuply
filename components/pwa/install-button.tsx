"use client";

import { useEffect, useState } from "react";
import { headerInstallPlan, installCopy, type InstallPlan } from "@/lib/pwa/install";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

export function InstallButton({ tone = "app" }: { tone?: "app" | "landing" }) {
  const [plan, setPlan] = useState<InstallPlan>("hidden");
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const sync = (canPrompt: boolean) => {
      setPlan(headerInstallPlan({ installed, userAgent: navigator.userAgent, canPrompt }));
    };
    sync(false);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
      sync(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (plan === "hidden") return null;
  const className =
    tone === "landing"
      ? "inline-flex min-h-12 items-center justify-center rounded-full bg-[#17573E] px-4 text-sm font-semibold text-white"
      : "inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-4 text-base font-semibold text-white";

  async function onClick() {
    setCopied(false);
    if (plan === "native" && promptEvent) {
      await promptEvent.prompt();
      setPromptEvent(null);
      setPlan(headerInstallPlan({ installed: false, userAgent: navigator.userAgent, canPrompt: false }));
      return;
    }
    const copy = installCopy({
      userAgent: navigator.userAgent,
      installed: false,
      ios: plan === "ios",
    });
    setNote(
      plan === "guidance"
        ? "This browser cannot show an install prompt. In Chrome or Edge, use the install icon in the address bar. On iPhone, use Safari, then Share, then Add to Home Screen."
        : copy ?? "Install Pickuply from the browser menu.",
    );
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
      setNote("Copy this page's address from the address bar, then open it in Safari or Chrome.");
    }
  }

  return (
    <div className="col-span-2 sm:col-auto">
      <button type="button" className={className} onClick={() => void onClick()}>
        Install Pickuply
      </button>
      {note ? (
        <div className="mt-2 max-w-sm rounded-2xl bg-paper-raised p-3 text-sm text-ink ring-1 ring-line" role="status">
          <p>{note}</p>
          {plan === "in-app" ? (
            <button type="button" className="mt-2 inline-flex min-h-12 items-center font-semibold text-brand" onClick={() => void copyLink()}>
              {copied ? "Link copied" : "Copy link"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
