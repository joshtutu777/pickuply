import { LastUpdate } from "@/components/request/last-update";
import type { JobTracker } from "@/lib/jobs/tracker";

export function JobTrackerView({
  tracker,
  driver,
  compact = false,
}: {
  tracker: JobTracker;
  driver?: { firstName: string; photoUrl: string | null; vehicle: string } | null;
  compact?: boolean;
}) {
  const current = tracker.steps.find((step) => step.state === "current");
  return (
    <section className="mt-6" aria-label="Job progress">
      {tracker.banner ? (
        <p className="mb-3 rounded-2xl bg-brand-soft px-4 py-3 text-base font-semibold text-ink">
          {tracker.banner}
        </p>
      ) : null}
      {driver ? (
        <div className="mb-3 flex items-center gap-3 rounded-2xl bg-paper-raised p-3 ring-1 ring-line">
          {driver.photoUrl ? (
            // Signed URL for the assigned driver's profile photo.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={driver.photoUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <span className="grid h-14 w-14 place-items-center rounded-full bg-brand-soft font-semibold text-brand">
              {driver.firstName.slice(0, 1)}
            </span>
          )}
          <div>
            <p className="text-lg font-semibold text-ink">{driver.firstName}</p>
            {driver.vehicle ? <p className="text-sm text-muted">{driver.vehicle}</p> : null}
          </div>
        </div>
      ) : null}
      {tracker.lastUpdate ? <LastUpdate iso={tracker.lastUpdate} /> : null}
      {compact ? (
        <p className="text-base font-semibold text-ink">{current?.label ?? tracker.steps.at(-1)?.label}</p>
      ) : (
        <ol className="grid gap-2">
          {tracker.steps.map((step) => (
            <li
              key={step.id}
              aria-current={step.state === "current" ? "step" : undefined}
              className={`flex min-h-12 items-center justify-between gap-3 rounded-2xl px-4 text-base ${
                step.state === "current"
                  ? "bg-brand font-semibold text-white"
                  : step.state === "done"
                    ? "bg-paper-raised font-semibold text-ink ring-1 ring-line"
                    : "bg-paper-raised text-muted ring-1 ring-line"
              }`}
            >
              <span>{step.label}</span>
              {step.at ? (
                <time className="text-sm font-medium" dateTime={step.at}>
                  {new Date(step.at).toLocaleString()}
                </time>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
