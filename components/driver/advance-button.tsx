"use client";

import { useTransition } from "react";
import { advanceJob } from "@/app/driver/jobs/actions";

export function AdvanceButton({
  jobId,
  nextStatus,
  label,
}: {
  jobId: string;
  nextStatus: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="inline-flex min-h-14 w-full items-center justify-center rounded-full bg-brand px-6 text-lg font-semibold text-white disabled:opacity-60"
      onClick={() => {
        const data = new FormData();
        data.set("jobId", jobId);
        data.set("nextStatus", nextStatus);
        startTransition(() => advanceJob(data));
      }}
    >
      {label}
    </button>
  );
}
