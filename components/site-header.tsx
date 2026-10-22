import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";

const primaryLink =
  "min-h-12 items-center justify-center rounded-full bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark";

const navLink =
  "inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-paper-raised px-4 text-base font-semibold text-ink transition-colors hover:border-brand";

export type HeaderState =
  | { status: "signed-out" }
  | { status: "signed-in"; firstName: string | null; alertsHref: string; unread: number };

export function SiteHeader({ state }: { state: HeaderState }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
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
          </Link>
          <Link href="/request" className={`inline-flex shrink-0 sm:hidden ${primaryLink}`}>
            Get a price
          </Link>
        </div>
        <nav aria-label="Primary" className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <Link href="/request" className={`hidden sm:inline-flex ${primaryLink}`}>
            Get a price
          </Link>
          {state.status === "signed-in" ? (
            <>
              {state.firstName ? (
                <span className="col-span-2 inline-flex min-h-12 items-center px-1 text-base font-semibold text-ink sm:col-auto">
                  {state.firstName}
                </span>
              ) : null}
              <Link href={state.alertsHref} className={navLink}>
                Alerts{state.unread > 0 ? ` (${state.unread})` : ""}
              </Link>
              <SignOutButton />
            </>
          ) : (
            <Link href="/login" className={navLink}>
              Log in
            </Link>
          )}
          <Link href="/driver/onboarding" className={navLink}>
            Drive with us
          </Link>
        </nav>
      </div>
    </header>
  );
}
