"use client";

import { useFormStatus } from "react-dom";
import { BusyMark } from "@/components/upload-picker";

export function PendingButton({
  idle,
  pendingLabel,
  className,
  name,
  value,
  blocked = false,
}: {
  idle: string;
  pendingLabel: string;
  className: string;
  name?: string;
  value?: string;
  blocked?: boolean;
}) {
  const status = useFormStatus();
  const submitted = status.data?.get(name ?? "")?.toString();
  const mine = status.pending && (name == null || submitted === value);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={status.pending || blocked}
      aria-busy={mine}
      className={className}
    >
      {mine ? (
        <span className="inline-flex items-center justify-center gap-2">
          <BusyMark />
          {pendingLabel}
        </span>
      ) : (
        idle
      )}
    </button>
  );
}
