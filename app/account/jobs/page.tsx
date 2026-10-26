import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DeliveryBoard } from "@/components/account/delivery-board";
import { BackLink } from "@/components/back-link";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { getAssignedDriverCard } from "@/lib/data/driver-card";
import { listOwnJobs } from "@/lib/data/job-queries";
import { customerJobTab } from "@/lib/jobs/customer-tabs";

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
  const named = jobs.filter(
    (job) => customerJobTab({ status: job.status, retired: job.test_retired_at != null }) === "active" && job.assigned_driver_id,
  );
  const driverNames: Record<string, string> = {};
  await Promise.all(
    named.map(async (job) => {
      const card = await getAssignedDriverCard(job.id);
      if (card?.firstName) driverNames[job.id] = card.firstName;
    }),
  );

  return (
    <main id="offers" className="mx-auto w-full max-w-xl flex-1 px-4 py-4">
      <BackLink href="/account" label="Account" />
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Your requests</h1>
      <p className="mt-1 text-base text-muted">Requests, active deliveries, and history stay in separate lists.</p>
      {error ? (
        <p role="alert" className="mt-4 text-base text-danger">
          We couldn&apos;t load your requests. Try again.
        </p>
      ) : jobs.length === 0 ? (
        <section className="mt-4 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
          <h2 className="text-xl font-semibold text-ink">No requests yet</h2>
          <p className="mt-2 text-base text-muted">When you submit a request, it shows up here.</p>
          <Link
            href="/request"
            className="mt-4 inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
          >
            Get a price
          </Link>
        </section>
      ) : (
        <DeliveryBoard jobs={jobs} driverNames={driverNames} />
      )}
    </main>
  );
}
