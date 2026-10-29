"use client";

import { useRef, useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { advanceJob } from "@/app/driver/jobs/actions";
import { proofTapAction } from "@/lib/jobs/proof-warning";

function AdvanceSubmit({ label, busy }: { label: string; busy: boolean }) {
  const { pending } = useFormStatus();
  const waiting = pending || busy;
  return (
    <button
      type="submit"
      disabled={waiting}
      aria-busy={waiting}
      className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-brand px-6 text-lg font-semibold text-white disabled:opacity-60"
    >
      {waiting ? (
        <>
          <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />
          {busy && !pending ? "Saving proof…" : "Updating status..."}
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
  fileChosen = false,
  prepare,
}: {
  jobId: string;
  nextStatus: string;
  label: string;
  blockedMessage?: string | null;
  proofInputId?: string;
  fileChosen?: boolean;
  prepare?: () => Promise<string | null>;
}) {
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const busy = useRef(false);
  const ready = useRef(false);
  const advanced = useRef(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    if (ready.current) {
      if (advanced.current) {
        event.preventDefault();
        return;
      }
      advanced.current = true;
      return;
    }
    const action = proofTapAction({
      busy: busy.current,
      needsProof: Boolean(blockedMessage),
      hasFile: Boolean(prepare),
    });
    if (action !== "advance") event.preventDefault();
    if (action === "ignore") return;
    if (action === "advance") {
      busy.current = true;
      advanced.current = true;
      return;
    }
    if (action === "warn") {
      setAttempted(true);
      setPrepareError(null);
      const field = document.getElementById(proofInputId);
      field?.scrollIntoView({ block: "center" });
      field?.focus();
      return;
    }
    busy.current = true;
    setSaving(true);
    setPrepareError(null);
    const form = event.currentTarget;
    void prepare?.()
      .then((error) => {
        if (error) {
          setAttempted(true);
          setPrepareError(error);
          busy.current = false;
          return;
        }
        ready.current = true;
        setAttempted(false);
        const button = form.querySelector('button[type="submit"]');
        if (button instanceof HTMLButtonElement) button.disabled = false;
        form.requestSubmit();
      })
      .catch(() => {
        setAttempted(true);
        setPrepareError("The proof could not be saved.");
        busy.current = false;
      })
      .finally(() => {
        if (!ready.current) setSaving(false);
      });
  }

  const alert = prepareError ?? (fileChosen ? null : blockedMessage);

  return (
    <form action={advanceJob} onSubmit={submit}>
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="nextStatus" value={nextStatus} />
      <AdvanceSubmit label={label} busy={saving} />
      {attempted && alert ? (
        <p id="proof-needed" role="alert" className="mt-3 text-base text-danger">
          {alert}
        </p>
      ) : null}
    </form>
  );
}
