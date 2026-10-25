import { betaMode } from "@/lib/beta";

export function BetaBadge() {
  if (!betaMode()) return null;
  return (
    <span className="inline-flex min-h-6 items-center rounded-full bg-brand-soft px-2 text-xs font-semibold tracking-wide text-brand-dark uppercase">
      Beta
    </span>
  );
}
