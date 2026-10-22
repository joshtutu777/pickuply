import type { Metadata } from "next";
import { Suspense } from "react";
import { JobView } from "@/components/request/job-view";

export const metadata: Metadata = {
  title: "Job status",
};

export default function JobPage({ params }: PageProps<"/jobs/[id]">) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10 text-lg text-muted">
          Loading this job.
        </main>
      }
    >
      <JobEntry params={params} />
    </Suspense>
  );
}

async function JobEntry({ params }: { params: PageProps<"/jobs/[id]">["params"] }) {
  const { id } = await params;
  return <JobView id={id} />;
}
