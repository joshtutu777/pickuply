import Link from "next/link";
import { statusLabel } from "@/components/request/job-status";
import { routeLabel } from "@/lib/messages/preview";

export function ConversationContext({
  name,
  role,
  jobLabel,
  pickup,
  dropoff,
  status,
  jobHref,
}: {
  name: string;
  role: string;
  jobLabel: string | null;
  pickup: string | null;
  dropoff: string | null;
  status: string | null;
  jobHref: string | null;
}) {
  const route = routeLabel(pickup, dropoff);
  const context = [jobLabel, route].filter(Boolean).join(" · ");
  return (
    <section className="mt-4 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <p className="text-base font-semibold text-ink">
        {name} — {role}
      </p>
      {context ? <p className="mt-1 text-sm text-muted">{context}</p> : null}
      {status ? <p className="mt-1 text-sm font-semibold text-ink">{statusLabel(status)}</p> : null}
      {jobHref ? (
        <Link href={jobHref} className="mt-2 inline-flex min-h-12 items-center font-semibold text-brand">
          Open job
        </Link>
      ) : null}
    </section>
  );
}
