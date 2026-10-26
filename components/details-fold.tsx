import type { ReactNode } from "react";

export function DetailsFold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="mt-3 rounded-3xl bg-paper-raised ring-1 ring-line">
      <summary className="flex min-h-12 cursor-pointer items-center px-4 text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {title}
      </summary>
      <div className="grid gap-2 px-4 pb-4">{children}</div>
    </details>
  );
}
