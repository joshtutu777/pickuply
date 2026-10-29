"use client";

import { useState } from "react";
import { ReportForm } from "@/components/request/report-form";

export function ReportToggle({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="inline-flex min-h-14 w-full items-center justify-center rounded-full bg-paper px-3 text-center text-base font-semibold text-ink ring-1 ring-line"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Report a problem
      </button>
      {open ? (
        <div className="col-span-2">
          <ReportForm jobId={jobId} embedded />
        </div>
      ) : null}
    </>
  );
}
