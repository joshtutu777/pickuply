"use client";

import { useEffect, useState } from "react";
import { headerInstallPlan, installButtonLabel, installCopy, type InstallPlan } from "@/lib/pwa/install";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

export function InstallButton({ tone = "app" }: { tone?: "app" | "landing" }) {
  const [plan, setPlan] = useState<InstallPlan>("hidden");
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [note, setNote] = useState("");
  const [stepsOpen, setStepsOpen] = useState(false);
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
    setStepsOpen(false);
    if (plan === "ios") {
      setStepsOpen(true);
      return;
    }
    if (plan === "native" && promptEvent) {
      await promptEvent.prompt();
      setPromptEvent(null);
      setPlan(headerInstallPlan({ installed: false, userAgent: navigator.userAgent, canPrompt: false }));
      return;
    }
    const copy = installCopy({
      userAgent: navigator.userAgent,
      installed: false,
      ios: false,
    });
    setNote(
      plan === "ios-browser"
        ? "Open this page in Safari, then tap Add Pickuply to Home Screen."
        : plan === "guidance"
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
        {installButtonLabel(plan)}
      </button>
      {stepsOpen ? <IosInstallSteps /> : null}
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

function IosInstallSteps() {
  const steps = [
    { title: "Tap Safari's Share button.", icon: <ShareIcon /> },
    { title: 'Select "Add to Home Screen."', icon: <HomeScreenIcon /> },
    { title: 'Tap "Add."', icon: <AddIcon /> },
  ];
  return (
    <ol className="mt-3 grid max-w-sm gap-3 rounded-3xl bg-paper-raised p-4 text-ink ring-1 ring-line">
      {steps.map((step, index) => (
        <li key={step.title} className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand text-white">
            {step.icon}
          </span>
          <span>
            <span className="block text-sm font-semibold text-muted">Step {index + 1}</span>
            <span className="text-base font-semibold">{step.title}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function ShareIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 16V4" />
      <path d="M7 8l5-5 5 5" />
      <path d="M6 12v7a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

function HomeScreenIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <path d="M12 8v6" />
      <path d="M9 11h6" />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="8" />
      <path d="M8 12h8" />
      <path d="M12 8v8" />
    </svg>
  );
}
