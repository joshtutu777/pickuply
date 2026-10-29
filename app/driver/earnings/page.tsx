import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { refreshPayoutSetup, startPayoutSetup } from "@/app/driver/connect/actions";
import { BackLink } from "@/components/back-link";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { sentTransferLine } from "@/lib/payments/earnings";
import { expressDashboardUrl } from "@/lib/payments/express-link";
import { payoutSetupLabel, payoutsReady, requirementLabels } from "@/lib/payments/requirements";
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
    .select("stripe_account_id, charges_enabled, payouts_enabled, transfers_active, details_submitted, requirements_due, disabled_reason")
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
    .select("stripe_account_id, charges_enabled, payouts_enabled, transfers_active, details_submitted, requirements_due, disabled_reason")
    .eq("driver_id", session.userId)
    .maybeSingle();
  const missing = requirementLabels(fresh?.requirements_due ?? []);
  const ready = payoutsReady(
    fresh
      ? { payouts_enabled: Boolean(fresh.payouts_enabled), transfers_active: Boolean(fresh.transfers_active) }
      : null,
  );
  const [{ data: entries }, { data: bankPayout }] = await Promise.all([
    supabase
      .from("ledger_entries")
      .select("id, job_id, amount_cents, status, hold_reason, transfer_status, external_method, created_at, updated_at, available_on, entry_kind")
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
  const dashboardUrl = (entries ?? []).some((entry) => entry.status === "transferred")
    ? await expressDashboardUrl(fresh?.stripe_account_id)
    : null;
  const totals = ledgerBuckets(entries ?? []);
  const tipRows = (entries ?? []).filter((entry) => entry.entry_kind === "tip");
  const baseRows = (entries ?? []).filter((entry) => entry.entry_kind !== "tip");
  const sum = (rows: { amount_cents: number }[]) => rows.reduce((total, row) => total + row.amount_cents, 0);
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
        These totals are your earnings. A card authorization is not earnings until the payment is captured.
      </p>
      <section className="mt-6 grid gap-3" aria-label="Earnings summary">
        <div className="grid grid-cols-3 gap-3">
          <MoneyBox label="Base earnings" cents={sum(baseRows)} />
          <MoneyBox label="Tips" cents={sum(tipRows)} />
          <MoneyBox label="Total earnings" cents={sum(baseRows) + sum(tipRows)} />
        </div>
        <p className="text-base text-muted">Tips are separate from base earnings. Tips are not shown before the job is completed.</p>
        <div className="rounded-3xl bg-brand p-4 text-white">
          <p className="text-sm font-semibold">Completed earnings</p>
          <p className="mt-1 font-display text-3xl font-semibold">{formatCents(totals.completedCents)}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <MoneyBox label="Pending" cents={sumStatus(entries ?? [], ["pending"])} />
          <MoneyBox label="Held" cents={sumStatus(entries ?? [], ["held", "held_until_onboarding"])} />
          <MoneyBox label="Eligible for transfer" cents={sumStatus(entries ?? [], ["ready"])} />
          <MoneyBox label="Transferred" cents={sumStatus(entries ?? [], ["transferred"])} />
        </div>
      </section>
      <section className="mt-6 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">{payoutSetupLabel(fresh)}</h2>
        {ready ? (
          <p className="mt-2 text-base text-ink">Stripe can send your earnings to your Stripe account. Bank deposits follow Stripe's payout schedule and may take a few additional business days.</p>
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
            {fresh ? "Update payout details" : "Set up payouts"}
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
          Latest bank payout: {bankPayout ? `${bankPayout.status} ${formatCents(bankPayout.amount_cents ?? 0)}` : "none yet"}.
        </p>
        {(entries ?? []).length === 0 ? <p className="mt-3">No earnings yet.</p> : null}
        <ul className="mt-3 grid gap-2">
          {(entries ?? []).map((entry) => (
            <li key={entry.id} className="rounded-2xl bg-paper px-3 py-3 ring-1 ring-line">
              {entry.status === "transferred" ? (
                <>
                  <p className="font-semibold">{entry.entry_kind === "tip" ? "Tip · " : ""}{sentTransferLine(entry.amount_cents, new Date(entry.updated_at))}</p>
                  <p className="text-sm text-muted">
                    Bank deposits follow Stripe's payout schedule and may take a few additional business days.{" "}
                    {dashboardUrl ? (
                      <a href={dashboardUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand">
                        Check your payout status in Stripe
                      </a>
                    ) : (
                      "Check your payout status in Stripe"
                    )}
                    .
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold">{entry.entry_kind === "tip" ? "Tip · " : ""}{formatCents(entry.amount_cents)} · {entry.status === "externally_paid" ? "Paid outside Stripe" : entry.status.replaceAll("_", " ")}</p>
                  <p className="text-sm text-muted">Transfer {entry.transfer_status ?? "not sent"}</p>
                </>
              )}
              {entry.external_method ? <p>Paid outside Stripe by {entry.external_method}</p> : null}
              {(entry.status === "held" || entry.status === "held_until_onboarding") ? (
                <p>{entry.hold_reason ?? "Needs payout setup"}</p>
              ) : null}
              {entry.entry_kind !== "tip" && entry.status === "pending" && entry.hold_reason?.includes("48 hours") ? (
                <p>Eligible 48 hours after this job was completed.</p>
              ) : null}
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

function sumStatus(entries: { status: string; amount_cents: number }[], statuses: string[]) {
  return entries.filter((entry) => statuses.includes(entry.status)).reduce((sum, entry) => sum + entry.amount_cents, 0);
}

function MoneyBox({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-ink">{formatCents(cents)}</p>
    </div>
  );
}
