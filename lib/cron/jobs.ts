export const cronJobs = [
  {
    name: "funnel-retention",
    label: "Funnel cleanup",
    schedule: "Daily at 4:00 UTC",
    route: "/api/cron/funnel-retention",
  },
  {
    name: "payment-deadlines",
    label: "Payment deadlines",
    schedule: "Every 5 minutes",
    route: "/api/cron/payment-deadlines",
  },
  {
    name: "notifications",
    label: "Notifications",
    schedule: "Every 5 minutes",
    route: "/api/cron/notifications",
  },
  {
    name: "auto-complete",
    label: "Delivery capture",
    schedule: "Every 15 minutes",
    route: "/api/cron/auto-complete",
  },
  {
    name: "transfers",
    label: "Driver transfers",
    schedule: "Every 15 minutes",
    route: "/api/cron/transfers",
  },
] as const;

export type CronJobName = (typeof cronJobs)[number]["name"];

export function isCronJobName(value: string): value is CronJobName {
  return cronJobs.some((job) => job.name === value);
}

export function cronRunLabel(ok: boolean | null): "Not run yet" | "Succeeded" | "Failed" {
  if (ok == null) return "Not run yet";
  return ok ? "Succeeded" : "Failed";
}
