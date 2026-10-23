"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { adminNavCurrent } from "@/lib/admin/ops";

const items = [
  { id: "overview", href: "/admin", label: "Overview" },
  { id: "requests", href: "/admin/requests", label: "Requests & Quotes" },
  { id: "jobs", href: "/admin/requests?stage=jobs", label: "Jobs & Assignments" },
  { id: "drivers", href: "/admin/drivers", label: "Drivers" },
  { id: "funnel", href: "/admin/funnel", label: "Funnel" },
  { id: "settings", href: "/admin/settings", label: "Settings" },
  { id: "help", href: "/admin/help", label: "Help" },
] as const;

function NavLinks({
  badges,
  current,
}: {
  badges: { overview: number; requests: number; jobs: number; drivers: number };
  current: ReturnType<typeof adminNavCurrent>;
}) {
  return (
    <ul className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const count = item.id === "settings" || item.id === "funnel" || item.id === "help" ? 0 : badges[item.id];
        const active = current === item.id;
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-12 items-center justify-between gap-3 rounded-2xl px-3 text-base font-semibold ${
                active ? "bg-brand-soft text-brand-dark" : "text-ink hover:bg-paper-raised"
              }`}
            >
              <span>{item.label}</span>
              {count > 0 ? (
                <span className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-full bg-brand px-2 text-sm text-white">
                  {count}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
      <li>
        <Link
          href="/admin/payments"
          aria-current={current === "payments" ? "page" : undefined}
          className={`flex min-h-12 items-center rounded-2xl px-3 text-base font-semibold ${
            current === "payments" ? "bg-brand-soft text-brand-dark" : "text-ink hover:bg-paper-raised"
          }`}
        >
          Payments
        </Link>
      </li>
      <li>
        <Link
          href="/admin/payouts"
          aria-current={current === "payouts" ? "page" : undefined}
          className={`flex min-h-12 items-center rounded-2xl px-3 text-base font-semibold ${
            current === "payouts" ? "bg-brand-soft text-brand-dark" : "text-ink hover:bg-paper-raised"
          }`}
        >
          Payouts
        </Link>
      </li>
    </ul>
  );
}

export function AdminNav({
  badges,
}: {
  badges: { overview: number; requests: number; jobs: number; drivers: number };
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const current = adminNavCurrent(pathname, search);

  return (
    <>
      <details className="border-b border-line bg-paper md:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 text-base font-semibold text-ink">
          Menu
          <span className="ml-2 font-normal text-muted">{items.find((item) => item.id === current)?.label}</span>
        </summary>
        <NavLinks badges={badges} current={current} />
      </details>
      <aside className="hidden w-72 shrink-0 border-r border-line md:block">
        <NavLinks badges={badges} current={current} />
      </aside>
    </>
  );
}
