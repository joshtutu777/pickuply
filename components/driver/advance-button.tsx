"use client";

import { useFormStatus } from "react-dom";
import { advanceJob } from "@/app/driver/jobs/actions";

function AdvanceSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-14 w-full items-center justify-center rounded-full bg-brand px-6 text-lg font-semibold text-white disabled:opacity-60"
    >
      {label}
    </button>
  );
}

export function AdvanceButton({
  jobId,
  nextStatus,
  label,
}: {
  jobId: string;
  nextStatus: string;
  label: string;
}) {
  return (
    <form action={advanceJob}>
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="nextStatus" value={nextStatus} />
      <AdvanceSubmit label={label} />
    </form>
  );
}
