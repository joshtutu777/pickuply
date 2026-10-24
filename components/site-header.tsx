import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { BetaBadge } from "@/components/beta-badge";
import { SignOutButton } from "@/components/sign-out-button";
import type { AppNavItem } from "@/lib/app-nav";
import { betaMode } from "@/lib/beta";

const primaryLink =
  "min-h-12 items-center justify-center rounded-full bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark";

const navLink =
  "inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-paper-raised px-4 text-base font-semibold text-ink transition-colors hover:border-brand";

export type HeaderState =
  | { status: "signed-out" }
  | {
      status: "signed-in";
      firstName: string | null;
      alertsHref: string;
      unread: number;
      area: string | null;
      appNav: boolean;
      appLabel: "Customer" | "Driver" | null;
      appLinks: AppNavItem[];
      messageUnread: number;
      offerUnread: number;
      homeHref: string;
      driveHref: string;
    };

export function SiteHeader({ state }: { state: HeaderState }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur-md">
      <div className="mx-auto w-full max-w-5xl px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={state.status === "signed-in" ? state.homeHref : "/"}
            className="inline-flex min-h-12 items-center gap-2.5 rounded-xl pr-1"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand font-display text-xl font-semibold text-white"
            >
              P
            </span>
            <span className="font-display text-[1.65rem] leading-none font-semibold tracking-tight text-ink">
              Pickuply
            </span>
            <BetaBadge />
          </Link>
          {state.status === "signed-in" && state.appNav ? null : (
            <Link href="/request" className={`inline-flex shrink-0 sm:hidden ${primaryLink}`}>
              Get a price
            </Link>
          )}
        </div>
        <nav aria-label="Primary" className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <Link href="/request" className={`hidden sm:inline-flex ${primaryLink}`}>
            Get a price
          </Link>
          {state.status === "signed-in" ? (
            <>
              {state.firstName ? (
                <span className={`col-span-2 inline-flex min-h-12 flex-col justify-center px-1 text-base font-semibold text-ink sm:col-auto ${state.appNav ? "max-sm:hidden" : ""}`}>
                  {state.firstName}
                  {state.area ? <span className="text-xs font-medium text-muted">{state.area}</span> : null}
                </span>
              ) : null}
              {state.appNav ? null : (
              <Link
                href={state.alertsHref}
                aria-label={state.unread > 0 ? `Alerts, ${state.unread} unread` : "Alerts"}
                className={`${navLink} relative`}
              >
                <span>Alerts</span>
                {state.unread > 0 ? (
                  <span className="ml-2 inline-flex min-w-5 justify-center rounded-full bg-brand px-1 text-xs text-white">
                    {state.unread > 9 ? "9+" : state.unread}
                  </span>
                ) : null}
              </Link>
              )}
              <SignOutButton />
            </>
          ) : (
            <Link href="/login" className={navLink}>
              Sign up / Sign in
            </Link>
          )}
          <Link
            href={state.status === "signed-in" ? state.driveHref : "/drive"}
            className={`${navLink}${state.status === "signed-in" && state.appNav ? " max-sm:hidden" : ""}`}
          >
            Drive with us
          </Link>
        </nav>
      </div>
      {state.status === "signed-in" && state.appLabel ? (
        <AppNav
          items={state.appLinks}
          label={state.appLabel}
          alertUnread={state.unread}
          messageUnread={state.messageUnread}
          offerUnread={state.offerUnread}
          showFeedback={betaMode()}
        />
      ) : null}
      </div>
    </header>
  );
}
