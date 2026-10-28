import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function ReconciliationPage() {
  await requireAdmin("/admin/finance/reconciliation");
  const supabase = await createClient();
  const result = await supabase.rpc("payment_reconciliation_issues");
  const rows = (result.data ?? []) as { job_id: string; issue: string }[];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <BackLink href="/admin/finance" label="Payments report" />
      <h1 className="mt-4 font-display text-3xl font-semibold text-ink">Payment check</h1>
      <p className="mt-2 text-base text-muted">These rows are mismatches in Pickuply&apos;s records. This page does not change a payment or contact Stripe.</p>
      {result.error ? (
        <p role="alert" className="mt-4 text-base text-danger">The payment check could not be loaded.</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-base text-ink">No mismatches in this check.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li key={`${row.job_id}-${row.issue}`} className="rounded-2xl bg-paper-raised p-4 ring-1 ring-line">
              <p className="text-base text-ink">{row.issue}</p>
              <Link className="mt-1 inline-flex min-h-12 items-center font-semibold text-brand" href={`/admin/jobs/${row.job_id}`}>
                Open job
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
