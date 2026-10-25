import type { TrackStep } from "@/lib/jobs/tracker";

export function DottedStepper({ steps }: { steps: TrackStep[] }) {
  return (
    <ol className="flex items-center" aria-hidden="true">
      {steps.map((step, index) => (
        <li key={step.id} className="flex min-w-0 flex-1 items-center last:flex-none">
          <span
            className={`size-2.5 shrink-0 rounded-full ${
              step.state === "upcoming" ? "bg-line" : "bg-brand"
            } ${step.state === "current" ? "ring-2 ring-brand/30" : ""}`}
          />
          {index < steps.length - 1 ? (
            <span
              className={`mx-1 h-0 flex-1 border-t-2 ${
                step.state === "upcoming" ? "border-line" : "border-dashed border-brand"
              }`}
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
