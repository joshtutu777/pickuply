"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { appNavActive, type AppNavItem } from "@/lib/app-nav";

export function AppNav({
  items,
  label,
  alertUnread = 0,
  messageUnread = 0,
  offerUnread = 0,
  showFeedback = false,
}: {
  items: AppNavItem[];
  label: "Customer" | "Driver";
  alertUnread?: number;
  messageUnread?: number;
  offerUnread?: number;
  showFeedback?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="mt-2 hidden md:block">
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => {
          const current = appNavActive(pathname, item.href);
          const count =
            item.icon === "alerts"
              ? alertUnread
              : item.icon === "messages"
                ? messageUnread
                : item.href === "/account/jobs"
                  ? offerUnread
                  : 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                aria-label={item.href === "/account/jobs" && count > 0 ? `Requests, ${count} new offers` : undefined}
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
        {showFeedback ? (
          <li>
            <Link
              href={`/feedback?from=${encodeURIComponent(pathname || "/")}`}
              aria-current={pathname === "/feedback" ? "page" : undefined}
              className={`inline-flex min-h-12 items-center justify-center rounded-full px-4 text-base font-semibold ${
                pathname === "/feedback" ? "bg-brand text-white" : "bg-paper-raised text-ink ring-1 ring-line hover:ring-brand"
              }`}
            >
              Send Feedback
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
