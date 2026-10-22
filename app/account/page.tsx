import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { JobList } from "@/components/request/job-list";
import { LoadingMain } from "@/components/loading-main";
import { singleQuery } from "@/lib/auth/query";
import { requireSignedIn } from "@/lib/auth/session";
import { listOwnJobs } from "@/lib/data/job-queries";

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
  await requireSignedIn("/account");
  const params = await searchParams;
  const { jobs, error } = await listOwnJobs();

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Account</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Your requests</h1>
      {singleQuery(params.error) === "forbidden" ? (
        <p role="alert" className="mt-4 text-base font-medium text-danger">
          You don&apos;t have access to that page.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-6 text-lg text-danger">
          We couldn&apos;t load your requests. Try again.
        </p>
      ) : (
        <JobList
          jobs={jobs}
          showTracker
          emptyTitle="No requests yet"
          emptyCopy="When you submit a request, it shows up here. Drivers do not see it until it is confirmed."
        />
      )}
      {jobs.length > 0 ? (
        <p className="mt-6">
          <Link
            href="/request"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
          >
            Get a price
          </Link>
        </p>
      ) : null}
    </main>
  );
}
