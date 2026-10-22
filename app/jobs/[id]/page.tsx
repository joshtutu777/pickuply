import type { Metadata } from "next";
import { Suspense } from "react";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Job status",
};

export default function JobPage({ params }: PageProps<"/jobs/[id]">) {
  return (
    <Suspense
      fallback={
        <PlaceholderPage
          eyebrow="Job"
          title="Job status"
          description="Loading this job."
        />
      }
    >
      <JobStatus params={params} />
    </Suspense>
  );
}

async function JobStatus({
  params,
}: {
  params: PageProps<"/jobs/[id]">["params"];
}) {
  const { id } = await params;

  return (
    <PlaceholderPage
      eyebrow="Job"
      title="Job status"
      description={`Status for job ${id} will show here once pickups are live.`}
    />
  );
}
