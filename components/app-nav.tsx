"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { appNavActive, type AppNavItem } from "@/lib/app-nav";

function useHash() {
  return useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("hashchange", onStoreChange);
      return () => window.removeEventListener("hashchange", onStoreChange);
    },
    () => window.location.hash,
    () => "",
  );
}

export function AppNav({
  items,
  label,
  alertUnread = 0,
  messageUnread = 0,
}: {
  items: AppNavItem[];
  label: "Customer" | "Driver";
  alertUnread?: number;
  messageUnread?: number;
}) {
  const pathname = usePathname();
  const hash = useHash();

  return (
    <nav aria-label={label} className="mt-2 hidden md:block">
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => {
          const current = appNavActive(pathname, item.href, hash);
          const count = item.icon === "alerts" ? alertUnread : item.icon === "messages" ? messageUnread : 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-12 items-center justify-center rounded-full px-4 text-base font-semibold ${
                  current ? "bg-brand text-white" : "bg-paper-raised text-ink ring-1 ring-line hover:ring-brand"
                }`}
              >
                {item.label}
                {count > 0 ? (
                  <span className={`ml-2 inline-flex min-w-5 justify-center rounded-full px-1 text-xs ${current ? "bg-white text-brand" : "bg-brand text-white"}`}>
                    {count > 9 ? "9+" : count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
