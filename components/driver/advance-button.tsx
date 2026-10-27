"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { advanceJob } from "@/app/driver/jobs/actions";

function AdvanceSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-brand px-6 text-lg font-semibold text-white disabled:opacity-60"
    >
      {pending ? (
        <>
          <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />
          Updating status...
        </>
      ) : (
        label
      )}
    </button>
  );
}

export function AdvanceButton({
  jobId,
  nextStatus,
  label,
  blockedMessage = null,
  proofInputId = "proof-file",
}: {
  jobId: string;
  nextStatus: string;
  label: string;
  blockedMessage?: string | null;
  proofInputId?: string;
}) {
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!blockedMessage) setAttempted(false);
  }, [blockedMessage]);

  return (
    <form
      action={advanceJob}
      onSubmit={(event) => {
        if (!blockedMessage) return;
        event.preventDefault();
        setAttempted(true);
        const field = document.getElementById(proofInputId);
        field?.scrollIntoView({ block: "center" });
        field?.focus();
      }}
    >
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="nextStatus" value={nextStatus} />
      <AdvanceSubmit label={label} />
      {attempted && blockedMessage ? (
        <p id="proof-needed" role="alert" className="mt-3 text-base text-danger">
          {blockedMessage}
        </p>
      ) : null}
    </form>
  );
}
