"use client";

import { useEffect, useState, type ReactNode } from "react";

export type ScreenTab = {
  id: string;
  label: string;
  count?: number;
  panel: ReactNode;
};

export function ScreenTabs({
  label,
  tabs,
  initial,
  hashMap,
}: {
  label: string;
  tabs: ScreenTab[];
  initial: string;
  hashMap?: Record<string, string>;
}) {
  const [current, setCurrent] = useState(initial);

  const tabIds = tabs.map((tab) => tab.id).join(" ");
  useEffect(() => {
    const apply = () => {
      const hash = window.location.hash.replace("#", "");
      const mapped = hashMap?.[hash];
      if (!mapped || !tabIds.split(" ").includes(mapped)) return;
      setCurrent(mapped);
      document.querySelector("[data-app-scroll]")?.scrollTo({ top: 0 });
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [hashMap, tabIds]);

  function choose(id: string) {
    setCurrent(id);
    const hash = Object.entries(hashMap ?? {}).find(([, tab]) => tab === id)?.[0];
    if (hash) {
      const url = new URL(window.location.href);
      url.hash = hash;
      window.history.replaceState(null, "", url);
    }
    document.querySelector("[data-app-scroll]")?.scrollTo({ top: 0 });
  }

  const selected = tabs.find((tab) => tab.id === current) ?? tabs[0];

  return (
    <div className="mt-3">
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const on = tab.id === selected?.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${label}-${tab.id}-tab`}
              aria-selected={on}
              aria-controls={`${label}-${tab.id}-panel`}
              onClick={() => choose(tab.id)}
              className={`inline-flex min-h-12 items-center gap-2 rounded-full px-3 text-sm font-semibold ${
                on ? "bg-brand text-white" : "bg-paper-raised text-ink ring-1 ring-line"
              }`}
            >
              {tab.label}
              {tab.count != null ? (
                <span className={`inline-flex min-w-5 justify-center rounded-full px-1 text-xs ${on ? "bg-white text-brand" : "bg-brand text-white"}`}>
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => {
        const on = tab.id === selected?.id;
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${label}-${tab.id}-panel`}
            aria-labelledby={`${label}-${tab.id}-tab`}
            hidden={!on}
            className="mt-3"
          >
            {tab.panel}
          </div>
        );
      })}
    </div>
  );
}
