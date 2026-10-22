import type { Metadata } from "next";
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
      <p className="mt-3 text-base leading-relaxed text-muted">
        Requests are read only. Quoting is not available here yet. Requested jobs stay hidden from
        drivers.
      </p>
      {error ? (
        <p role="alert" className="mt-6 text-lg text-danger">
          We couldn&apos;t load requests. Try again.
        </p>
      ) : (
        <JobList
          jobs={jobs}
          showPricing
          emptyTitle="No requests yet"
          emptyCopy="New customer requests will be listed here."
          actionHref={null}
        />
      )}
    </main>
  );
}
