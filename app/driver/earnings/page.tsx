import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { refreshPayoutSetup, startPayoutSetup } from "@/app/driver/connect/actions";
import { BackLink } from "@/components/back-link";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { payoutSetupLabel, requirementLabels } from "@/lib/payments/requirements";
import { refreshConnectAccount } from "@/lib/payments/connect";
import { formatCents } from "@/lib/money";
import { ledgerBuckets } from "@/lib/payments/ledger-summary";
import { createClient } from "@/lib/supabase/server";

export default function EarningsPage({ searchParams }: PageProps<"/driver/earnings">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Earnings searchParams={searchParams} />
    </Suspense>
  );
}

async function Earnings({ searchParams }: { searchParams: PageProps<"/driver/earnings">["searchParams"] }) {
  await connection();
  const session = await requireSignedIn("/driver/earnings");
  if (session.role !== "driver") {
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
        <BackLink href="/driver" label="Driver home" />
        <h1 className="font-display text-4xl font-semibold text-ink">Earnings</h1>
        <p className="mt-4 text-base text-muted">Payout setup is for drivers.</p>
      </main>
    );
  }
  const query = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("driver_connect_accounts")
    .select("stripe_account_id, charges_enabled, payouts_enabled, details_submitted, requirements_due, disabled_reason")
    .eq("driver_id", session.userId)
    .maybeSingle();

  if (query.connect === "return" && data?.stripe_account_id) {
    try {
      await refreshConnectAccount(session.userId, data.stripe_account_id);
    } catch {
      // The page still shows the last saved status.
    }
  }

  const { data: fresh } = await supabase
    .from("driver_connect_accounts")
    .select("stripe_account_id, charges_enabled, payouts_enabled, details_submitted, requirements_due, disabled_reason")
    .eq("driver_id", session.userId)
    .maybeSingle();
  const missing = requirementLabels(fresh?.requirements_due ?? []);
  const ready = Boolean(fresh?.payouts_enabled);
  const [{ data: entries }, { data: bankPayout }] = await Promise.all([
    supabase
      .from("ledger_entries")
      .select("id, job_id, amount_cents, status, hold_reason, transfer_status, external_method, created_at")
      .eq("driver_id", session.userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("driver_bank_payouts")
      .select("status, amount_cents, created_at")
      .eq("driver_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const totals = ledgerBuckets(entries ?? []);
  const weekAgo = new Date().getTime() - 7 * 24 * 60 * 60 * 1000;
  const week = (entries ?? []).filter((entry) => new Date(entry.created_at).getTime() >= weekAgo);
  const weekTotal = (status: string) =>
    week.filter((entry) => entry.status === status).reduce((sum, entry) => sum + entry.amount_cents, 0);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href="/driver" label="Driver home" />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Driver</p>
      <h1 className="mt-3 font-display text-4xl font-semibold text-ink">Earnings</h1>
      <p className="mt-3 text-base text-muted">
        These totals use captured earnings from your ledger. A card authorization is not earnings until the payment is captured.
      </p>
      <section className="mt-6 grid gap-3" aria-label="Earnings summary">
        <div className="rounded-3xl bg-brand p-4 text-white">
          <p className="text-sm font-semibold">Completed earnings</p>
          <p className="mt-1 font-display text-3xl font-semibold">{formatCents(totals.completedCents)}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
            <p className="text-sm font-semibold text-muted">Pending transfer</p>
            <p className="mt-1 text-xl font-semibold text-ink">{formatCents(totals.pendingCents)}</p>
          </div>
          <div className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
            <p className="text-sm font-semibold text-muted">Transferred</p>
            <p className="mt-1 text-xl font-semibold text-ink">{formatCents(totals.transferredCents)}</p>
          </div>
        </div>
      </section>
      <section className="mt-6 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">{payoutSetupLabel(fresh)}</h2>
        {ready ? (
          <p className="mt-2 text-base text-ink">Stripe can send your earnings. Bank deposit timing is separate and shows after a transfer.</p>
        ) : (
          <p className="mt-2 text-base text-ink">
            You can still take jobs. Earnings stay held until Stripe can pay you, unless an admin records an outside payment.
          </p>
        )}
        {fresh?.disabled_reason ? (
          <p className="mt-2 text-base text-danger">Stripe paused this payout account. Open setup to see what they need.</p>
        ) : null}
        {missing.length > 0 ? (
          <ul className="mt-3 list-disc pl-5 text-base text-ink">
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        <form action={startPayoutSetup} className="mt-4">
          <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white">
            {fresh ? (ready ? "Review payout setup" : "Finish payout setup") : "Set up payouts"}
          </button>
        </form>
        {fresh ? (
          <form action={refreshPayoutSetup} className="mt-2">
            <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-brand">
              Check payout status
            </button>
          </form>
        ) : null}
        {typeof query.error === "string" ? <p className="mt-3 text-base text-danger">{query.error}</p> : null}
        {query.saved === "1" ? <p className="mt-3 text-base text-ink">Payout status updated.</p> : null}
      </section>
      <section className="mt-4 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">This week</h2>
        <p>Pending {formatCents(weekTotal("pending"))}</p>
        <p>Held {formatCents(weekTotal("held") + weekTotal("held_until_onboarding"))}</p>
        <p>Transferred {formatCents(weekTotal("transferred"))}</p>
        <p className="mt-2 text-base text-muted">
          Latest bank payout: {bankPayout ? `${bankPayout.status} ${formatCents(bankPayout.amount_cents ?? 0)}` : "none yet"}. A transfer is not a bank deposit.
        </p>
        {(entries ?? []).length === 0 ? <p className="mt-3">No earnings yet.</p> : null}
        <ul className="mt-3 grid gap-2">
          {(entries ?? []).map((entry) => (
            <li key={entry.id} className="rounded-2xl bg-paper px-3 py-3 ring-1 ring-line">
              <p className="font-semibold">{formatCents(entry.amount_cents)} · {entry.status === "externally_paid" ? "Paid outside Stripe" : entry.status.replaceAll("_", " ")}</p>
              <p className="text-sm text-muted">Transfer {entry.transfer_status ?? "not sent"}</p>
              {entry.external_method ? <p>Paid outside Stripe by {entry.external_method}</p> : null}
              {entry.hold_reason ? <p>{entry.hold_reason}</p> : null}
            </li>
          ))}
        </ul>
      </section>
      <p className="mt-4">
        <Link href="/driver" className="inline-flex min-h-12 items-center font-semibold text-brand">
          Driver home
        </Link>
      </p>
    </main>
  );
}
