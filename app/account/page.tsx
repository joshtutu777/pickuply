import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CustomerJobCard } from "@/components/account/job-card";
import { ServiceTiles } from "@/components/mobile/service-tiles";
import { LoadingMain } from "@/components/loading-main";
import { singleQuery } from "@/lib/auth/query";
import { firstName } from "@/lib/auth/name";
import { requireSignedIn } from "@/lib/auth/session";
import { listOwnJobs } from "@/lib/data/job-queries";
import { pickCurrentJob } from "@/lib/jobs/next-action";

export const metadata: Metadata = {
  title: "Your account",
};

export default function AccountPage({ searchParams }: PageProps<"/account">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <AccountContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AccountContent({
  searchParams,
}: {
  searchParams: PageProps<"/account">["searchParams"];
}) {
  const session = await requireSignedIn("/account");
  const params = await searchParams;
  const { jobs, error } = await listOwnJobs();
  const current = pickCurrentJob(jobs);
  const recent = jobs.filter((job) => job.id !== current?.id).slice(0, 3);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Home</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        Hi, {firstName(session.fullName) ?? "there"}
      </h1>
      <p className="mt-2 text-base text-muted">You find it. We pick it up.</p>
      {singleQuery(params.error) === "forbidden" ? (
        <p role="alert" className="mt-4 text-base font-medium text-danger">
          You don&apos;t have access to that page.
        </p>
      ) : null}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="flex min-h-24 flex-col justify-between rounded-3xl bg-brand p-4 text-white">
          <Link href="/request" className="inline-flex min-h-12 items-center text-base font-semibold">
            Get a price
          </Link>
          <p className="text-sm font-medium text-white/80">New request</p>
        </div>
        <div className="flex min-h-24 flex-col justify-between rounded-3xl bg-paper-raised p-4 text-ink ring-1 ring-line">
          <Link href="/account/jobs" className="inline-flex min-h-12 items-center text-base font-semibold">
            Your requests
          </Link>
          <p className="text-sm font-medium text-muted">See every job</p>
        </div>
      </div>
      <h2 className="mt-8 text-lg font-semibold text-ink">Services</h2>
      <div className="mt-3">
        <ServiceTiles />
      </div>
      {error ? (
        <p role="alert" className="mt-6 text-lg text-danger">
          We couldn&apos;t load your requests. Try again.
        </p>
      ) : jobs.length === 0 ? (
        <section className="mt-8 rounded-3xl bg-paper-raised p-5 ring-1 ring-line">
          <h2 className="text-xl font-semibold text-ink">Your requests</h2>
          <p className="mt-2 text-base leading-relaxed text-muted">
            When you submit a request, it shows up here. Drivers do not see it until it is confirmed.
          </p>
        </section>
      ) : (
        <>
          {current ? (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-ink">Current request</h2>
              <div className="mt-3">
                <CustomerJobCard job={current} featured />
              </div>
            </section>
          ) : null}
          <section className="mt-8">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-ink">Your requests</h2>
              {jobs.length > 1 ? (
                <Link href="/account/jobs" className="inline-flex min-h-12 items-center font-semibold text-brand">
                  See all
                </Link>
              ) : null}
            </div>
            {recent.length === 0 ? (
              <p className="mt-2 text-base text-muted">This is the only request on your account.</p>
            ) : (
              <ul className="mt-3 grid gap-3">
                {recent.map((job) => (
                  <li key={job.id}>
                    <CustomerJobCard job={job} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
