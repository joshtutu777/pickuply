import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CustomerJobCard } from "@/components/account/job-card";
import { BackLink } from "@/components/back-link";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { listOwnJobs } from "@/lib/data/job-queries";

export const metadata: Metadata = {
  title: "Your requests",
};

export default function JobsPage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <JobsContent />
    </Suspense>
  );
}

async function JobsContent() {
  await requireSignedIn("/account/jobs");
  const { jobs, error } = await listOwnJobs();

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href="/account" label="Account" />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Jobs</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Your requests</h1>
      <p className="mt-2 text-base text-muted">Every request on your account, including finished ones.</p>
      {error ? (
        <p role="alert" className="mt-6 text-lg text-danger">
          We couldn&apos;t load your requests. Try again.
        </p>
      ) : jobs.length === 0 ? (
        <section className="mt-8 rounded-3xl bg-paper-raised p-5 ring-1 ring-line">
          <h2 className="text-xl font-semibold text-ink">No requests yet</h2>
          <p className="mt-2 text-base leading-relaxed text-muted">
            When you submit a request, it shows up here. Drivers can offer as soon as it is open.
          </p>
          <Link
            href="/request"
            className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
          >
            Get a price
          </Link>
        </section>
      ) : (
        <ul className="mt-6 grid gap-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <CustomerJobCard job={job} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
