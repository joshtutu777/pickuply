"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; icon: "home" | "jobs" | "plus" | "messages" | "profile" | "earnings"; center?: boolean };

const customer: Item[] = [
  { href: "/account", label: "Home", icon: "home" },
  { href: "/account/jobs", label: "Jobs", icon: "jobs" },
  { href: "/request", label: "New", icon: "plus", center: true },
  { href: "/account/messages", label: "Messages", icon: "messages" },
  { href: "/account/profile", label: "Profile", icon: "profile" },
];

const driver: Item[] = [
  { href: "/driver", label: "Home", icon: "home" },
  { href: "/driver#jobs", label: "Jobs", icon: "jobs" },
  { href: "/driver/earnings", label: "Earnings", icon: "earnings" },
  { href: "/driver/profile", label: "Profile", icon: "profile" },
];

const hidden = [
  "/request",
  "/login",
  "/auth",
  "/driver/onboarding",
  "/driver/ready",
  "/driver/training",
];

function active(pathname: string, href: string): boolean {
  const path = href.split("#")[0];
  if (path === "/account") return pathname === "/account";
  if (path === "/driver") return pathname === "/driver" && !href.includes("#");
  if (href === "/driver#jobs") return false;
  return pathname === path || pathname.startsWith(`${path}/`);
}

function NavIcon({ icon }: { icon: Item["icon"] }) {
  const common = "size-5";
  if (icon === "plus") {
    return (
      <svg viewBox="0 0 24 24" className="size-7" aria-hidden="true">
        <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
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
  if (icon === "earnings") {
    return (
      <svg viewBox="0 0 24 24" className={common} aria-hidden="true">
        <path d="M12 4v16M16 8.5c0-1.5-1.8-2.5-4-2.5s-4 1-4 2.5 1.8 2.5 4 2.5 4 1 4 2.5-1.8 2.5-4 2.5-4-1-4-2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

export function BottomNav({ role }: { role: "customer" | "driver" | "admin" | null }) {
  const pathname = usePathname();
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  useEffect(() => {
    const id = window.location.hash.replace("#", "");
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [pathname]);
  if (!ready || (role !== "customer" && role !== "driver")) return null;
  if (hidden.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;
  const items = role === "driver" ? driver : customer;
  const raised = items.some((item) => item.center);

  return (
    <nav
      data-mobile-nav=""
      aria-label={role === "driver" ? "Driver" : "Customer"}
      className={`z-30 shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden ${raised ? "pt-8" : "pt-2"}`}
    >
      <ul className="mx-auto flex max-w-md items-end justify-between rounded-full bg-ink px-2 py-2 text-white shadow-lg">
        {items.map((item) => {
          const current = active(pathname, item.href);
          return (
            <li key={item.href} className={item.center ? "-mt-7" : ""}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-12 min-w-12 flex-col items-center justify-center rounded-full px-2 text-[11px] font-semibold ${
                  item.center
                    ? "size-14 bg-brand text-white"
                    : current
                      ? "bg-white/15 text-white"
                      : "text-white/80"
                }`}
              >
                <NavIcon icon={item.icon} />
                <span className={item.center ? "sr-only" : "mt-0.5"}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
