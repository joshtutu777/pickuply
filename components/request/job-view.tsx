"use client";

import dynamic from "next/dynamic";

const JobDemo = dynamic(() => import("./job-demo").then((mod) => mod.JobDemo), {
  ssr: false,
  loading: () => (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10 text-lg text-muted">Loading this job.</main>
  ),
});

export function JobView({ id }: { id: string }) {
  return <JobDemo key={id} id={id} />;
}
