import Link from "next/link";
import { betaMessage, betaMode } from "@/lib/beta";

export function BetaNotice({ from }: { from: string }) {
  if (!betaMode()) return null;
  return (
    <p className="mt-4 rounded-2xl bg-brand-soft px-4 py-3 text-base leading-relaxed text-ink">
      {betaMessage}{" "}
      <Link href={`/feedback?from=${encodeURIComponent(from)}`} className="font-semibold text-brand">
        Send Feedback
      </Link>
    </p>
  );
}
