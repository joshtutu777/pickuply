"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { appNavActive, customerNav, driverNav, type AppNavIcon } from "@/lib/app-nav";

const hidden = [
  "/request",
  "/login",
  "/auth",
  "/driver/onboarding",
  "/driver/ready",
  "/driver/training",
];

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

function NavIcon({ icon }: { icon: AppNavIcon }) {
  const common = "size-5";
  if (icon === "home") {
    return (
      <svg viewBox="0 0 24 24" className={common} aria-hidden="true">
        <path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  if (icon === "jobs") {
    return (
      <svg viewBox="0 0 24 24" className={common} aria-hidden="true">
        <path d="M8 7V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  if (icon === "messages") {
    return (
      <svg viewBox="0 0 24 24" className={common} aria-hidden="true">
        <path d="M5 6h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3v-3H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  if (icon === "alerts") {
    return (
      <svg viewBox="0 0 24 24" className={common} aria-hidden="true">
        <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2H4.5L6 16Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M10 19a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={common} aria-hidden="true">
      <circle cx="12" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 19c1.2-3 3.4-4.5 7-4.5S17.8 16 19 19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function BottomNav({
  role,
  messageUnread = 0,
  alertUnread = 0,
}: {
  role: "customer" | "driver" | "admin" | null;
  messageUnread?: number;
  alertUnread?: number;
}) {
  const pathname = usePathname();
  const hash = useHash();
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  useEffect(() => {
    const id = window.location.hash.replace("#", "");
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [pathname, hash]);
  if (!ready || (role !== "customer" && role !== "driver")) return null;
  if (hidden.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;
  const customerArea = pathname === "/account" || pathname.startsWith("/account/") || pathname.startsWith("/jobs/");
  const items = role === "driver" && !customerArea ? driverNav : customerNav;
  const label = items === driverNav ? "Driver" : "Customer";

  return (
    <nav
      data-mobile-nav=""
      aria-label={label}
      className="z-30 shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
    >
      <ul className="mx-auto flex max-w-md items-end justify-between rounded-full bg-ink px-2 py-2 text-white shadow-lg">
        {items.map((item) => {
          const current = appNavActive(pathname, item.href, hash);
          const count = item.icon === "alerts" ? alertUnread : item.icon === "messages" ? messageUnread : 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-12 min-w-12 flex-col items-center justify-center rounded-full px-2 text-[11px] font-semibold ${
                  current ? "bg-white/15 text-white" : "text-white/80"
                }`}
              >
                <span className="relative">
                  <NavIcon icon={item.icon} />
                  {count > 0 ? (
                    <span className="absolute -top-1 -right-2 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] text-white">
                      {count > 9 ? "9+" : count}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
