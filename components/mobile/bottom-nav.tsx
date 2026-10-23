"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; icon: string; center?: boolean };

const customer: Item[] = [
  { href: "/account", label: "Home", icon: "H" },
  { href: "/account/jobs", label: "Jobs", icon: "J" },
  { href: "/request", label: "New", icon: "+", center: true },
  { href: "/account/messages", label: "Messages", icon: "M" },
  { href: "/account/profile", label: "Profile", icon: "P" },
];

const driver: Item[] = [
  { href: "/driver", label: "Home", icon: "H" },
  { href: "/driver#jobs", label: "Jobs", icon: "J" },
  { href: "/driver/earnings", label: "Earnings", icon: "E" },
  { href: "/driver/profile", label: "Profile", icon: "P" },
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

export function BottomNav({ role }: { role: "customer" | "driver" | "admin" | null }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  if (!ready || (role !== "customer" && role !== "driver")) return null;
  if (hidden.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;
  const items = role === "driver" ? driver : customer;

  return (
    <nav
      data-mobile-nav=""
      aria-label={role === "driver" ? "Driver" : "Customer"}
      className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
    >
      <ul className="mx-auto flex max-w-md items-end justify-between rounded-full bg-ink px-2 py-2 text-white shadow-lg">
        {items.map((item) => {
          const current = active(pathname, item.href);
          return (
            <li key={item.href} className={item.center ? "-mt-6" : ""}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-12 min-w-12 flex-col items-center justify-center rounded-full px-2 text-[11px] font-semibold ${
                  item.center
                    ? "size-14 bg-brand text-base text-white"
                    : current
                      ? "bg-white/15 text-white"
                      : "text-white/80"
                }`}
              >
                <span aria-hidden="true">{item.icon}</span>
                <span className={item.center ? "sr-only" : ""}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
