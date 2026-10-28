"use client";

import { useEffect, useState } from "react";
import { reportCustomerNoShow } from "@/app/driver/jobs/actions";

const waitMs = 15 * 60 * 1000;

export function NoShowWait({ jobId, arrivedAt }: { jobId: string; arrivedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  const remaining = new Date(arrivedAt).getTime() + waitMs - now;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (remaining > 0) {
    const seconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(seconds / 60);
    const rest = String(seconds % 60).padStart(2, "0");
    return (
      <p className="mt-3 text-base text-ink">
        Customer no-show timer: {minutes}:{rest}. This does not cancel the job or charge a fee.
      </p>
    );
  }

  return (
    <form action={reportCustomerNoShow} className="mt-3 grid gap-2">
      <p className="text-base text-ink">
        15 minutes have passed. You can report a customer no-show after adding a photo of the wait. Pickuply reviews it. This does not charge a fee.
      </p>
      <input type="hidden" name="jobId" value={jobId} />
      <button
        type="submit"
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-paper px-6 font-semibold text-ink ring-1 ring-line"
      >
        Report customer no-show
      </button>
    </form>
  );
}
