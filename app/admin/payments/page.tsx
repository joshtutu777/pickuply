import Link from "next/link";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { formatCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export default function PaymentsPage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Payments />
    </Suspense>
  );
}

async function Payments() {
  await requireAdmin("/admin/payments");
  const supabase = await createClient();
  const [{ data: jobs }, { data: refunds }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, status, payment_status, price_cents, captured_cents, refunded_cents, service_fee_cents")
      .in("payment_status", ["awaiting_payment", "authorized", "failed", "captured", "canceled", "refunded"])
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase.from("refund_requests").select("id, job_id, amount_cents, status, reason").order("created_at", { ascending: false }).limit(25),
  ]);
  const ids = (jobs ?? []).map((job) => job.id);
  const { data: payments } = ids.length
    ? await supabase.from("job_payments").select("job_id, stripe_fee_cents, fee_shortfall, capture_before").in("job_id", ids)
    : { data: [] };
  const feeByJob = new Map((payments ?? []).map((row) => [row.job_id, row]));

  return (
    <main className="px-4 py-8">
      <h1 className="font-display text-4xl font-semibold text-ink">Payments</h1>
      <p className="mt-2 text-base text-muted">Card holds, captures, and refunds. A shortfall means the Stripe fee was higher than the service fee.</p>
      {(jobs ?? []).length === 0 ? <p className="mt-6">No card payments yet.</p> : null}
      <ul className="mt-6 grid gap-3">
        {(jobs ?? []).map((job) => {
          const fee = feeByJob.get(job.id);
          return (
            <li key={job.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
              <p className="font-semibold">
                <Link href={`/admin/requests/${job.id}`} className="text-brand">
                  {job.status.replaceAll("_", " ")}
                </Link>
                {" · "}
                {job.payment_status?.replaceAll("_", " ")}
              </p>
              <p>Total {formatCents(job.price_cents ?? 0)} · Captured {formatCents(job.captured_cents ?? 0)} · Refunded {formatCents(job.refunded_cents ?? 0)}</p>
              <p>Stripe fee {fee?.stripe_fee_cents == null ? "not posted yet" : formatCents(fee.stripe_fee_cents)} · Service fee {formatCents(job.service_fee_cents ?? 0)}</p>
              {fee?.fee_shortfall ? <p>The card fee was higher than the service fee.</p> : null}
              {fee?.capture_before ? <p>Authorization ends {new Date(fee.capture_before).toLocaleString()}.</p> : null}
            </li>
          );
        })}
      </ul>
      <h2 className="mt-8 text-2xl font-semibold text-ink">Refunds</h2>
      {(refunds ?? []).length === 0 ? <p className="mt-3">No refunds yet.</p> : null}
      <ul className="mt-3 grid gap-2">
        {(refunds ?? []).map((refund) => (
          <li key={refund.id}>
            {formatCents(refund.amount_cents)} · {refund.status} · {refund.reason}
          </li>
        ))}
      </ul>
    </main>
  );
}
