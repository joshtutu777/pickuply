import Link from "next/link";
import { howItWorks, services, trustPoints } from "@/lib/constants";

const primaryAction =
  "inline-flex min-h-14 w-full items-center justify-center rounded-full bg-brand px-6 text-center text-lg font-semibold text-white transition-colors hover:bg-brand-dark sm:w-auto";

const secondaryAction =
  "inline-flex min-h-14 w-full items-center justify-center rounded-full border border-line bg-paper px-6 py-3 text-center text-base font-semibold leading-snug text-ink transition-colors hover:border-brand sm:w-auto sm:text-lg";

export default function HomePage() {
  return (
    <main className="flex-1">
      <section className="px-4 pt-4 sm:pt-8">
        <div className="mx-auto max-w-5xl rounded-[2rem] bg-paper-raised px-5 py-8 ring-1 ring-line sm:px-10 sm:py-14">
          <div className="max-w-2xl">
            <h1 className="font-display text-[clamp(2.15rem,9vw,3.75rem)] font-semibold leading-[1.08] tracking-tight text-ink">
              You Find It. We Pick It Up.
            </h1>
            <p className="mt-5 text-xl leading-snug text-ink sm:text-2xl">
              Found it. Bought it. Can&apos;t pick it up? We&apos;ll bring it
              home.
            </p>
            <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
              Early access for local pickup, store delivery, and junk hauling.
              Drivers send offers. You choose who to book.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href="/request" className={primaryAction}>
                Get a price
              </Link>
              <Link href="/signup" className={secondaryAction}>
                Sign up
              </Link>
              <Link href="/driver/apply" className={secondaryAction}>
                Apply to drive
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="services-heading" className="px-4 py-10">
        <div className="mx-auto max-w-5xl">
          <h2
            id="services-heading"
            className="font-display text-3xl font-semibold tracking-tight text-ink"
          >
            What we pick up
          </h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {services.map((service) => (
              <li key={service.id}>
                <Link
                  href={`/request?service=${service.id}`}
                  className="block min-h-24 rounded-3xl bg-paper-raised p-5 ring-1 ring-line transition-colors hover:ring-brand"
                >
                  <h3 className="text-xl font-semibold text-ink">{service.name}</h3>
                  <p className="mt-2 text-base leading-relaxed text-muted">
                    {service.summary}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="how-heading" className="px-4 pb-4">
        <div className="mx-auto max-w-5xl">
          <h2
            id="how-heading"
            className="font-display text-3xl font-semibold tracking-tight text-ink"
          >
            How it works
          </h2>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {howItWorks.map((step, index) => (
              <li
                key={step}
                className="rounded-3xl bg-paper-raised p-5 ring-1 ring-line"
              >
                <span className="inline-flex size-11 items-center justify-center rounded-full bg-brand-soft text-lg font-semibold text-brand">
                  {index + 1}
                </span>
                <p className="mt-4 text-lg font-semibold leading-snug text-ink">
                  {step}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-label="Why Pickuply" className="px-4 py-8">
        <ul className="mx-auto flex max-w-5xl flex-col overflow-hidden rounded-3xl bg-brand text-white sm:flex-row">
          {trustPoints.map((point) => (
            <li
              key={point}
              className="flex min-h-16 flex-1 items-center border-b border-white/20 px-5 py-4 text-base font-semibold last:border-b-0 sm:border-r sm:border-b-0 sm:px-6 sm:py-6 sm:last:border-r-0"
            >
              {point}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
