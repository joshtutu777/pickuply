"use client";

import Link from "next/link";
import { ScreenTabs } from "@/components/ui/screen-tabs";
import { statusLabel } from "@/components/request/job-status";
import { driverJobCounts, driverJobHref, type DriverJobGroups, type DriverJobListItem } from "@/lib/driver/job-groups";
import { formatCents } from "@/lib/money";

type AvailableJob = {
  id: string;
  service: string;
  pickupArea: string;
  dropoffArea: string | null;
  driverPayCents: number | null;
};

function money(job: DriverJobListItem) {
  const earnings = job.driverPayCents ?? null;
  const amount = earnings != null && job.platformFeeCents != null ? earnings + job.platformFeeCents : null;
  return { earnings, amount };
}

function AssignedCard({ job }: { job: DriverJobListItem }) {
  const href = driverJobHref(job);
  const { earnings, amount } = money(job);
  const body = (
    <>
      <p className="font-semibold text-ink">{job.service.replaceAll("_", " ")}</p>
      <p className="text-sm text-ink">
        {job.pickupArea}
        {job.dropoffArea ? ` → ${job.dropoffArea}` : ""}
      </p>
      <p className="text-sm text-ink">{job.retired ? "Closed" : statusLabel(job.status)}</p>
      {amount != null ? <p className="text-sm text-ink">Job Amount: {formatCents(amount)}</p> : null}
      {earnings != null ? <p className="text-sm font-semibold text-ink">Your Estimated Earnings: {formatCents(earnings)}</p> : null}
      {href ? <p className="mt-1 font-semibold text-brand">Open job</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="block min-h-12 rounded-3xl bg-paper-raised p-3 ring-1 ring-line">
      {body}
    </Link>
  ) : (
    <p className="rounded-3xl bg-paper-raised p-3 text-muted ring-1 ring-line">{body}</p>
  );
}

function List({ jobs, empty }: { jobs: DriverJobListItem[]; empty: string }) {
  if (jobs.length === 0) return <p className="text-base text-muted">{empty}</p>;
  return (
    <ul className="grid gap-2">
      {jobs.map((job) => (
        <li key={job.id}>
          <AssignedCard job={job} />
        </li>
      ))}
    </ul>
  );
}

export function DriverJobBoard({
  groups,
  available,
  feedError,
}: {
  groups: DriverJobGroups;
  available: AvailableJob[];
  feedError: boolean;
}) {
  const counts = driverJobCounts(groups, available.length);
  return (
    <ScreenTabs
      label="Driver jobs"
      initial="available"
      tabs={[
        {
          id: "available",
          label: "Available",
          count: counts.available,
          panel: feedError ? (
            <p role="alert" className="text-base text-danger">Available jobs could not be loaded.</p>
          ) : available.length === 0 ? (
            <p className="text-base text-muted">No available jobs right now.</p>
          ) : (
            <ul className="grid gap-2">
              {available.map((job) => (
                <li key={job.id}>
                  <Link href={`/driver#job-${job.id}`} className="block min-h-12 rounded-3xl bg-paper-raised p-3 ring-1 ring-line">
                    <p className="font-semibold text-ink">{job.service.replaceAll("_", " ")}</p>
                    <p className="text-sm text-ink">
                      {job.pickupArea}
                      {job.dropoffArea ? ` → ${job.dropoffArea}` : ""}
                    </p>
                    <p className="text-sm text-ink">Available</p>
                    {job.driverPayCents != null ? (
                      <p className="text-sm font-semibold text-ink">Your Estimated Earnings: {formatCents(job.driverPayCents)}</p>
                    ) : null}
                    <p className="mt-1 font-semibold text-brand">View job</p>
                  </Link>
                </li>
              ))}
            </ul>
          ),
        },
        { id: "mine", label: "My Jobs", count: counts.mine, panel: <List jobs={groups.mine} empty="No assigned jobs yet." /> },
        { id: "active", label: "Active", count: counts.active, panel: <List jobs={groups.active} empty="No job is in progress." /> },
        { id: "awaiting", label: "Awaiting Payment", count: counts.awaiting, panel: <List jobs={groups.awaiting} empty="No job is waiting on payment." /> },
        { id: "completed", label: "Completed", count: counts.completed, panel: <List jobs={groups.completed} empty="No completed jobs yet." /> },
        { id: "closed", label: "Closed", count: counts.closed, panel: <List jobs={groups.closed} empty="No cancelled or closed jobs." /> },
      ]}
    />
  );
}
