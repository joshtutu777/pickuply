import type { TrackStep } from "@/lib/jobs/tracker";

export function DottedStepper({ steps }: { steps: TrackStep[] }) {
  return (
    <ol className="flex items-center gap-1" aria-hidden="true">
      {steps.map((step) => (
        <li
          key={step.id}
          className={`h-2 flex-1 rounded-full ${
            step.state === "upcoming" ? "bg-line" : "bg-brand"
          } ${step.state === "current" ? "ring-2 ring-brand/30" : ""}`}
        />
      ))}
    </ol>
  );
}
