const paid = new Set(["authorized", "paid", "captured"]);
const activeStatuses = new Set(["en_route", "arrived", "item_check", "in_transit", "delivered"]);

export type DriverJobListItem = {
  id: string;
  service: string;
  status: string;
  paymentStatus: string | null;
  pickupArea: string;
  dropoffArea?: string | null;
  driverPayCents?: number | null;
  platformFeeCents?: number | null;
  retired: boolean;
};

export type DriverJobGroups = {
  mine: DriverJobListItem[];
  active: DriverJobListItem[];
  awaiting: DriverJobListItem[];
  completed: DriverJobListItem[];
  closed: DriverJobListItem[];
};

/** Assigned-job lists for the driver Jobs page. Retired jobs stay in Closed and are not actionable. */
export function groupDriverJobs(jobs: DriverJobListItem[]): DriverJobGroups {
  const open = jobs.filter((job) => !job.retired);
  const retired = jobs.filter((job) => job.retired);
  return {
    mine: open.filter((job) => !["completed", "cancelled", "disputed"].includes(job.status)),
    active: open.filter((job) => activeStatuses.has(job.status)),
    awaiting: open.filter((job) => job.status === "assigned" && !paid.has(job.paymentStatus ?? "")),
    completed: open.filter((job) => job.status === "completed"),
    closed: [...open.filter((job) => job.status === "cancelled" || job.status === "disputed"), ...retired],
  };
}

export function driverJobHref(job: DriverJobListItem): string | null {
  return job.retired ? null : `/driver/jobs/${job.id}`;
}

export function driverJobCounts(groups: DriverJobGroups, available: number) {
  return {
    available,
    mine: groups.mine.length,
    active: groups.active.length,
    awaiting: groups.awaiting.length,
    completed: groups.completed.length,
    closed: groups.closed.length,
  };
}
