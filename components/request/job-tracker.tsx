import Link from "next/link";
import { DottedStepper } from "@/components/mobile/dotted-stepper";
import { LastUpdate } from "@/components/request/last-update";
import type { CustomerProgress, JobTracker } from "@/lib/jobs/tracker";

export function JobTrackerView({
  tracker,
  driver,
  compact = false,
  chatHref,
  progress,
}: {
  tracker: JobTracker;
  driver?: { firstName: string; photoUrl: string | null; vehicle: string } | null;
  compact?: boolean;
  chatHref?: string;
  progress?: CustomerProgress;
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
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-ink">{driver.firstName}</p>
            {driver.vehicle ? <p className="text-sm text-muted">{driver.vehicle}</p> : null}
          </div>
          {chatHref ? (
            <Link href={chatHref} className="inline-flex min-h-12 items-center rounded-full bg-brand px-4 font-semibold text-white">
              Chat
            </Link>
          ) : null}
        </div>
      ) : null}
      {tracker.lastUpdate ? <LastUpdate iso={tracker.lastUpdate} /> : null}
      {progress ? (
        <CustomerMilestones progress={progress} history={tracker.steps.filter((step) => step.state !== "upcoming")} />
      ) : (
        <>
      <div className="mt-3">
        <DottedStepper steps={tracker.steps} />
      </div>
      {compact ? (
        <p className="text-base font-semibold text-ink">{current?.label ?? tracker.steps.at(-1)?.label}</p>
      ) : (
        <ol className="mt-3 grid gap-2">
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
        </>
      )}
    </section>
  );
}

function CustomerMilestones({
  progress,
  history,
}: {
  progress: CustomerProgress;
  history: JobTracker["steps"];
}) {
  return (
    <div className="mt-3" aria-label={`Step ${progress.stepNumber} of 4: ${progress.stepName}`}>
      <div aria-hidden="true" className="grid grid-cols-4 gap-1">
        {progress.milestones.map((step) => (
          <div key={step.id} className="min-w-0 text-center">
            <span
              className={`mx-auto block size-2.5 rounded-full ${
                step.state === "upcoming" ? "bg-line" : "bg-brand"
              } ${step.state === "current" ? "ring-2 ring-brand/30 ring-offset-2 ring-offset-paper" : ""}`}
            />
            <span
              className={`mt-2 block text-[0.7rem] leading-tight font-semibold ${
                step.state === "upcoming" ? "text-muted" : "text-ink"
              }`}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm leading-snug text-ink">Right now: {progress.next}</p>
      {progress.action ? <p className="mt-1 text-sm font-semibold text-ink">{progress.action}</p> : null}
      {history.length > 0 ? (
        <details className="mt-2">
          <summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold text-brand">
            See full history
          </summary>
          <ul className="grid gap-2 pb-1">
            {history.map((step) => (
              <li key={step.id} className="rounded-2xl bg-paper-raised px-3 py-2 text-sm ring-1 ring-line">
                <span className="font-semibold text-ink">{step.label}</span>
                {step.at ? (
                  <time className="mt-0.5 block text-muted" dateTime={step.at}>
                    {new Date(step.at).toLocaleString()}
                  </time>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
