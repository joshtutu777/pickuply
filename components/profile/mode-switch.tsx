"use client";

import { useTransition } from "react";
import { switchMode } from "@/app/profile/actions";

const row =
  "flex min-h-12 w-full items-center rounded-3xl bg-paper-raised px-4 text-left font-semibold text-ink ring-1 ring-line disabled:opacity-60";

export function ModeSwitch({ mode, label }: { mode: "customer" | "driver"; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={row}
      disabled={pending}
      onClick={() => startTransition(() => switchMode(mode))}
    >
      {label}
    </button>
  );
}
