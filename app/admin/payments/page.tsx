import Link from "next/link";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { LoadingMain } from "@/components/loading-main";
import { IncludeTestData } from "@/components/admin/include-test-data";
import { resolveTestLane } from "@/lib/admin/test-lane-server";
import { requireAdmin } from "@/lib/auth/session";
import { formatCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export default function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Payments searchParams={searchParams} />
    </Suspense>
  );
}

async function Payments({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/payments");
  const params = await searchParams;
  const lane = await resolveTestLane(params.includeTest === "1" || (Array.isArray(params.includeTest) && params.includeTest[0] === "1"));
  const supabase = await createClient();
  let jobsQuery = supabase
    .from("jobs")
    .select("id, status, payment_status, price_cents, driver_pay_cents, platform_fee_cents, captured_cents, refunded_cents, service_fee_cents, is_test")
    .in("payment_status", ["awaiting_payment", "authorized", "failed", "captured", "canceled", "refunded"])
    .order("updated_at", { ascending: false })
    .limit(50);
  if (lane !== "all") jobsQuery = jobsQuery.eq("is_test", lane === "test");
  const [{ data: jobs }, { data: refunds }, { data: disputes }] = await Promise.all([
    jobsQuery,
    supabase.from("refund_requests").select("id, job_id, amount_cents, status, reason").order("created_at", { ascending: false }).limit(25),
    supabase.from("card_disputes").select("stripe_dispute_id, job_id, amount_cents, status, outcome").order("updated_at", { ascending: false }).limit(25),
  ]);
  const relatedIds = [...new Set([...(refunds ?? []).map((row) => row.job_id), ...(disputes ?? []).map((row) => row.job_id)])];
  const { data: relatedJobs } = relatedIds.length
    ? await supabase.from("jobs").select("id, is_test").in("id", relatedIds)
    : { data: [] as { id: string; is_test: boolean }[] };
  const visibleJobs = new Set(
    (relatedJobs ?? [])
      .filter((job) => lane === "all" || job.is_test === (lane === "test"))
      .map((job) => job.id),
  );
  const shownRefunds = (refunds ?? []).filter((row) => visibleJobs.has(row.job_id));
  const shownDisputes = (disputes ?? []).filter((row) => visibleJobs.has(row.job_id));
  const ids = (jobs ?? []).map((job) => job.id);
  const { data: payments } = ids.length
    ? await supabase.from("job_payments").select("job_id, stripe_fee_cents, fee_shortfall, capture_before").in("job_id", ids)
    : { data: [] };
  const feeByJob = new Map((payments ?? []).map((row) => [row.job_id, row]));

  return (
    <main className="px-4 py-8">
      <BackLink href="/admin" label="Admin" />
      <h1 className="font-display text-4xl font-semibold text-ink">Payments</h1>
      {lane === "test" ? null : (
        <IncludeTestData include={lane === "all"} path="/admin/payments" search={lane === "all" ? "includeTest=1" : ""} />
      )}
      <p className="mt-2"><Link href="/admin/finance" className="font-semibold text-brand">Open the payments report</Link></p>
      <p className="mt-2 text-base text-muted">Card holds, captures, and refunds. A shortfall means Stripe&apos;s fee was higher than the card processing collected from the customer.</p>
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
              <p>Offer {job.driver_pay_cents == null ? "not set" : formatCents((job.driver_pay_cents ?? 0) + (job.platform_fee_cents ?? 0))} · Card processing {formatCents(job.service_fee_cents ?? 0)} · Pickuply commission {formatCents(job.platform_fee_cents ?? 0)} · Driver earnings {job.driver_pay_cents == null ? "not set" : formatCents(job.driver_pay_cents)}</p>
              <p>Stripe fee {fee?.stripe_fee_cents == null ? "not posted yet" : formatCents(fee.stripe_fee_cents)} · Payment {job.payment_status ?? "not started"}</p>
              {fee?.fee_shortfall ? <p>Stripe&apos;s fee was higher than the card processing collected.</p> : null}
              {fee?.capture_before ? <p>Authorization ends {new Date(fee.capture_before).toLocaleString()}.</p> : null}
            </li>
          );
        })}
      </ul>
      <h2 className="mt-8 text-2xl font-semibold text-ink">Card disputes</h2>
      {shownDisputes.length === 0 ? <p className="mt-3">No card disputes.</p> : null}
      <ul className="mt-3 grid gap-2">
        {shownDisputes.map((dispute) => (
          <li key={dispute.stripe_dispute_id}>
            {formatCents(dispute.amount_cents ?? 0)} · {dispute.status}
            {dispute.outcome ? ` · ${dispute.outcome}` : " · open"}
          </li>
        ))}
      </ul>
      <h2 className="mt-8 text-2xl font-semibold text-ink">Refunds</h2>
      {shownRefunds.length === 0 ? <p className="mt-3">No refunds yet.</p> : null}
      <ul className="mt-3 grid gap-2">
        {shownRefunds.map((refund) => (
          <li key={refund.id}>
            {formatCents(refund.amount_cents)} · {refund.status} · {refund.reason}
          </li>
        ))}
      </ul>
    </main>
  );
}
