"use client";

import { useFormStatus } from "react-dom";

export function PendingButton({
  idle,
  pendingLabel,
  className,
  name,
  value,
}: {
  idle: string;
  pendingLabel: string;
  className: string;
  name?: string;
  value?: string;
}) {
  const status = useFormStatus();
  const submitted = status.data?.get(name ?? "")?.toString();
  const mine = status.pending && (name == null || submitted === value);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={status.pending}
      aria-busy={mine}
      className={className}
    >
      {mine ? (
        <span className="inline-flex items-center justify-center gap-2">
          <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
          {pendingLabel}
        </span>
      ) : (
        idle
      )}
    </button>
  );
}
