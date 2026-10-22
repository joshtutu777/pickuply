import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { JobList } from "@/components/request/job-list";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { listAllJobs } from "@/lib/data/job-queries";

export const metadata: Metadata = {
  title: "Admin",
};

export default function AdminPage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <AdminContent />
    </Suspense>
  );
}

async function AdminContent() {
  await requireAdmin("/admin");
  const { jobs, error } = await listAllJobs();

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Admin</h1>
      <div className="mt-4 flex gap-4">
        <Link href="/admin/drivers" className="inline-flex min-h-12 items-center font-semibold text-brand">
          Review drivers
        </Link>
        <Link href="/admin/settings" className="inline-flex min-h-12 items-center font-semibold text-brand">
          Settings
        </Link>
      </div>
      <p className="mt-3 text-base leading-relaxed text-muted">
        Open a request to set the zone and publish it, or to send a quote. Requested jobs stay
        hidden from drivers.
      </p>
      {error ? (
        <p role="alert" className="mt-6 text-lg text-danger">
          We couldn&apos;t load requests. Try again.
        </p>
      ) : (
        <JobList
          jobs={jobs}
          showPricing
          hrefFor={(id) => `/admin/requests/${id}`}
          emptyTitle="No requests yet"
          emptyCopy="New customer requests will be listed here."
          actionHref={null}
        />
      )}
    </main>
  );
}
