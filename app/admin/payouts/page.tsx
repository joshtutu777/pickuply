import { Suspense } from "react";
import Link from "next/link";
import { recordOutsidePayment, recoverDeduction, recoverReversal } from "@/app/admin/payouts/actions";
import { BackLink } from "@/components/back-link";
import { LoadingMain } from "@/components/loading-main";
import { IncludeTestData } from "@/components/admin/include-test-data";
import { inTestLane, includeTestParam } from "@/lib/admin/test-lane";
import { resolveTestLane } from "@/lib/admin/test-lane-server";
import { requireAdmin } from "@/lib/auth/session";
import { formatCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export default function PayoutsPage({ searchParams }: PageProps<"/admin/payouts">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Payouts searchParams={searchParams} />
    </Suspense>
  );
}

async function Payouts({ searchParams }: { searchParams: PageProps<"/admin/payouts">["searchParams"] }) {
  await requireAdmin("/admin/payouts");
  const query = await searchParams;
  const lane = await resolveTestLane(includeTestParam(query.includeTest));
  const supabase = await createClient();
  const [{ data: entries }, { data: recoveries }, { data: drivers }, { data: accounts }] = await Promise.all([
    supabase
      .from("ledger_entries")
      .select("id, job_id, driver_id, amount_cents, status, hold_reason, transfer_status, stripe_transfer_id, external_method")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("recovery_obligations")
      .select("id, amount_cents, status, reason, ledger_id")
      .eq("status", "recovery_due")
      .limit(25),
    supabase.from("drivers").select("profile_id, status").in("status", ["approved_new", "active", "paused"]),
    supabase.from("driver_connect_accounts").select("driver_id, payouts_enabled"),
  ]);
  const readyAccounts = new Set((accounts ?? []).filter((account) => account.payouts_enabled).map((account) => account.driver_id));
  const entryJobs = [...new Set((entries ?? []).map((entry) => entry.job_id))];
  const driverIds = (drivers ?? []).map((driver) => driver.profile_id);
  const [{ data: jobFlags }, { data: driverFlags }] = await Promise.all([
    entryJobs.length ? supabase.from("jobs").select("id, is_test").in("id", entryJobs) : Promise.resolve({ data: [] as { id: string; is_test: boolean }[] }),
    driverIds.length ? supabase.from("profiles").select("id, is_test").in("id", driverIds) : Promise.resolve({ data: [] as { id: string; is_test: boolean }[] }),
  ]);
  const testJobs = new Map((jobFlags ?? []).map((row) => [row.id, row.is_test === true]));
  const testDrivers = new Map((driverFlags ?? []).map((row) => [row.id, row.is_test === true]));
  const laneEntries = (entries ?? []).filter((entry) => inTestLane(testJobs.get(entry.job_id) ?? false, lane));
  const laneDrivers = (drivers ?? []).filter((driver) => inTestLane(testDrivers.get(driver.profile_id) ?? false, lane));
  const needsOnboarding = laneDrivers.filter((driver) => !readyAccounts.has(driver.profile_id));
  const nameIds = needsOnboarding.map((driver) => driver.profile_id);
  const { data: nameRows } = nameIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", nameIds)
    : { data: [] };
  const names = new Map((nameRows ?? []).map((row) => [row.id, row.full_name]));
  const failedTransfers = laneEntries.filter((entry) => entry.transfer_status === "failed");

  return (
    <main className="px-4 py-8">
      <BackLink href="/admin" label="Admin" />
      <h1 className="font-display text-4xl font-semibold text-ink">Payouts</h1>
      {lane === "test" ? null : (
        <IncludeTestData include={lane === "all"} path="/admin/payouts" search={lane === "all" ? "includeTest=1" : ""} />
      )}
      <p className="mt-2 text-base text-muted">
        A transfer sends earnings to the driver Stripe account. It is not a deposit in their bank. Paid outside Stripe is an admin record, not a transfer.
      </p>
      {typeof query.error === "string" ? <p className="mt-4 text-danger">{query.error}</p> : null}
      <h2 className="mt-6 text-2xl font-semibold">Drivers who still need payout setup</h2>
      {needsOnboarding.length === 0 ? <p className="mt-2">Every approved driver can receive transfers.</p> : null}
      <ul className="mt-2 grid gap-2">
        {needsOnboarding.map((driver) => (
          <li key={driver.profile_id}>
            <Link className="font-semibold text-brand" href={`/admin/drivers/${driver.profile_id}`}>
              {names.get(driver.profile_id) ?? "Driver"}
            </Link>
          </li>
        ))}
      </ul>
      <h2 className="mt-6 text-2xl font-semibold">Failed transfers</h2>
      {failedTransfers.length === 0 ? <p className="mt-2">No failed transfers.</p> : null}
      <ul className="mt-2 grid gap-2">
        {failedTransfers.map((entry) => (
          <li key={entry.id}>
            {formatCents(entry.amount_cents)} · {entry.hold_reason ?? "The transfer failed and will be tried again."}
          </li>
        ))}
      </ul>
      {laneEntries.length === 0 ? <p className="mt-6">No earnings yet.</p> : null}
      <ul className="mt-6 grid gap-4">
        {laneEntries.map((entry) => (
          <li key={entry.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
            <p className="font-semibold">{formatCents(entry.amount_cents)} · {entry.status === "externally_paid" ? "Paid outside Stripe" : entry.status.replaceAll("_", " ")}</p>
            <p>Transfer {entry.transfer_status ?? "not sent"}</p>
            {entry.external_method ? <p>Paid outside Stripe by {entry.external_method}</p> : null}
            {entry.hold_reason ? <p>{entry.hold_reason}</p> : null}
            {entry.status !== "transferred" && entry.status !== "externally_paid" && entry.status !== "recovered" ? (
              <form action={recordOutsidePayment} className="mt-3 grid gap-2">
                <input type="hidden" name="entryId" value={entry.id} />
                <label className="font-semibold" htmlFor={`method-${entry.id}`}>
                  Method
                  <input id={`method-${entry.id}`} name="method" required className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3" />
                </label>
                <label className="font-semibold" htmlFor={`reference-${entry.id}`}>
                  Reference
                  <input id={`reference-${entry.id}`} name="reference" className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3" />
                </label>
                <label className="font-semibold" htmlFor={`reason-${entry.id}`}>
                  Reason
                  <input id={`reason-${entry.id}`} name="reason" required minLength={3} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3" />
                </label>
                <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-brand">
                  Record external payment
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      <h2 className="mt-8 text-2xl font-semibold">Recovery</h2>
      <p className="mt-2 text-base text-muted">Nothing is deducted or reversed until you choose it here.</p>
      {(recoveries ?? []).length === 0 ? <p className="mt-3">No recoveries due.</p> : null}
      <ul className="mt-3 grid gap-4">
        {(recoveries ?? []).map((item) => (
          <li key={item.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
            <p className="font-semibold">{formatCents(item.amount_cents)} due</p>
            <p>{item.reason}</p>
            <form action={recoverReversal} className="mt-3 grid gap-2">
              <input type="hidden" name="obligationId" value={item.id} />
              <label className="font-semibold" htmlFor={`reverse-${item.id}`}>
                Reason for reversing the transfer
                <input id={`reverse-${item.id}`} name="reason" required minLength={3} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3" />
              </label>
              <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-brand">
                Reverse the transfer
              </button>
            </form>
            <form action={recoverDeduction} className="mt-3 grid gap-2">
              <input type="hidden" name="obligationId" value={item.id} />
              <label className="font-semibold" htmlFor={`entry-${item.id}`}>
                Future earning id
                <input id={`entry-${item.id}`} name="entryId" required className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3" />
              </label>
              <label className="font-semibold" htmlFor={`deduct-${item.id}`}>
                Reason
                <input id={`deduct-${item.id}`} name="reason" required minLength={3} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3" />
              </label>
              <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-brand">
                Deduct from that earning
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
