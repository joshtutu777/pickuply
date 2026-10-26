import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { LoadingMain } from "@/components/loading-main";
import { statusLabel } from "@/components/request/job-status";
import { requireSignedIn } from "@/lib/auth/session";
import { driverJobHref, groupDriverJobs, type DriverJobListItem } from "@/lib/driver/job-groups";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Jobs" };

export default function DriverJobsPage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <DriverJobs />
    </Suspense>
  );
}

function JobLinks({ jobs, empty }: { jobs: DriverJobListItem[]; empty: string }) {
  if (jobs.length === 0) return <p className="mt-2 text-base text-muted">{empty}</p>;
  return (
    <ul className="mt-2 grid gap-2">
      {jobs.map((job) => {
        const href = driverJobHref(job);
        const label = `${job.service.replaceAll("_", " ")} · ${job.pickupArea} · ${statusLabel(job.status)}`;
        return (
          <li key={job.id}>
            {href ? (
              <Link href={href} className="block min-h-12 rounded-3xl bg-paper-raised p-4 font-semibold text-brand ring-1 ring-line">
                {label}
              </Link>
            ) : (
              <p className="rounded-3xl bg-paper-raised p-4 text-base text-muted ring-1 ring-line">{label} · Closed</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

async function DriverJobs() {
  const session = await requireSignedIn("/driver/jobs");
  const supabase = await createClient();
  const [{ data, error }, feed] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, service, status, payment_status, pickup_area, test_retired_at")
      .eq("assigned_driver_id", session.userId)
      .order("updated_at", { ascending: false }),
    supabase.rpc("driver_job_feed"),
  ]);
  const groups = groupDriverJobs(
    (data ?? []).map((job) => ({
      id: job.id,
      service: job.service,
      status: job.status,
      paymentStatus: job.payment_status,
      pickupArea: job.pickup_area,
      retired: job.test_retired_at != null,
    })),
  );
  const available = ((feed.data ?? []) as { id: string; service: string; pickup_area: string; status?: string }[]);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-4">
      <BackLink href="/driver" label="Driver home" />
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Jobs</h1>
      <section className="mt-4" aria-label="Available jobs">
        <h2 className="text-lg font-semibold text-ink">Available jobs</h2>
        {feed.error ? (
          <p role="alert" className="mt-2 text-base text-danger">
            Available jobs could not be loaded.{" "}
            <Link href="/driver/jobs" className="font-semibold underline">
              Try again
            </Link>
          </p>
        ) : available.length === 0 ? (
          <p className="mt-2 text-base text-muted">No available jobs right now.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {available.map((job) => (
              <li key={job.id}>
                <Link href={`/driver#job-${job.id}`} className="block min-h-12 rounded-3xl bg-paper-raised p-4 font-semibold text-ink ring-1 ring-line">
                  {job.service.replaceAll("_", " ")} · {job.pickup_area}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {error ? (
        <p role="alert" className="mt-4 text-base text-danger">
          Your jobs could not be loaded.
        </p>
      ) : (
        <>
          <section className="mt-6" aria-label="My jobs">
            <h2 className="text-lg font-semibold text-ink">My jobs</h2>
            <JobLinks jobs={groups.mine} empty="No assigned jobs yet." />
          </section>
          <section className="mt-6" aria-label="Active jobs">
            <h2 className="text-lg font-semibold text-ink">Active / in progress</h2>
            <JobLinks jobs={groups.active} empty="No job is in progress." />
          </section>
          <section className="mt-6" aria-label="Awaiting payment">
            <h2 className="text-lg font-semibold text-ink">Awaiting payment</h2>
            <JobLinks jobs={groups.awaiting} empty="No job is waiting on payment." />
          </section>
          <section className="mt-6" aria-label="Completed jobs">
            <h2 className="text-lg font-semibold text-ink">Completed</h2>
            <JobLinks jobs={groups.completed} empty="No completed jobs yet." />
          </section>
          <section className="mt-6" aria-label="Cancelled or closed jobs">
            <h2 className="text-lg font-semibold text-ink">Cancelled or closed</h2>
            <JobLinks jobs={groups.closed} empty="No cancelled or closed jobs." />
          </section>
        </>
      )}
    </main>
  );
}
