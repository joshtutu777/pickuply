"use client";

import { CustomerJobCard } from "@/components/account/job-card";
import { ScreenTabs } from "@/components/ui/screen-tabs";
import type { JobSummary } from "@/lib/data/job-queries";
import { customerJobTab } from "@/lib/jobs/customer-tabs";

const hashMap = {
  offers: "requests",
  requests: "requests",
  active: "active",
  history: "history",
};

export function DeliveryBoard({
  jobs,
  driverNames,
}: {
  jobs: JobSummary[];
  driverNames: Record<string, string>;
}) {
  const grouped = {
    requests: jobs.filter((job) => customerJobTab({ status: job.status, retired: job.test_retired_at != null }) === "requests"),
    active: jobs.filter((job) => customerJobTab({ status: job.status, retired: job.test_retired_at != null }) === "active"),
    history: jobs.filter((job) => customerJobTab({ status: job.status, retired: job.test_retired_at != null }) === "history"),
  };

  const panel = (items: JobSummary[], empty: string) =>
    items.length === 0 ? (
      <p className="text-base text-muted">{empty}</p>
    ) : (
      <ul className="grid gap-2">
        {items.map((job) => (
          <li key={job.id}>
            <CustomerJobCard job={job} driverName={driverNames[job.id] ?? null} />
          </li>
        ))}
      </ul>
    );

  return (
    <ScreenTabs
      label="My deliveries"
      initial="requests"
      hashMap={hashMap}
      tabs={[
        { id: "requests", label: "Requests", count: grouped.requests.length, panel: panel(grouped.requests, "No requests waiting.") },
        { id: "active", label: "Active", count: grouped.active.length, panel: panel(grouped.active, "No active deliveries.") },
        { id: "history", label: "History", count: grouped.history.length, panel: panel(grouped.history, "No finished deliveries.") },
      ]}
    />
  );
}
