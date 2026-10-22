import type { Metadata } from "next";
import { Suspense } from "react";
import { JobMissing, JobStatus } from "@/components/request/job-status";
import { getJobDetail } from "@/lib/data/job-queries";

export const metadata: Metadata = {
  title: "Request",
};

export default function JobPage({ params }: PageProps<"/jobs/[id]">) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10 text-lg text-muted">
          Loading this request.
        </main>
      }
    >
      <JobEntry params={params} />
    </Suspense>
  );
}

async function JobEntry({ params }: { params: PageProps<"/jobs/[id]">["params"] }) {
  const { id } = await params;
  const job = await getJobDetail(id);
  if (!job) return <JobMissing />;
  return <JobStatus job={job} />;
}
