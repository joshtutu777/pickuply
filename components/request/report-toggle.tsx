"use client";

import { useState } from "react";
import { ReportForm } from "@/components/request/report-form";

export function ReportToggle({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-3">
      <button
        type="button"
        className="inline-flex min-h-14 w-full items-center justify-center rounded-full bg-paper px-6 text-lg font-semibold text-ink ring-1 ring-line"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Report an Issue
      </button>
      {open ? <ReportForm jobId={jobId} embedded /> : null}
    </div>
  );
}
