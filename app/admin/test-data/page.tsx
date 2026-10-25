import Link from "next/link";
import { Suspense } from "react";
import { cleanupTestData } from "@/app/admin/test-data/actions";
import { LoadingMain } from "@/components/loading-main";
import { resolveTestLane } from "@/lib/admin/test-lane-server";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

type Preview = {
  profiles: number;
  jobs: number;
  notifications: number;
  push_subscriptions: number;
  funnel_events: number;
  ledger_kept: number;
  payments_kept: number;
  messages_kept: number;
};

export default function TestDataPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <TestData searchParams={searchParams} />
    </Suspense>
  );
}

async function TestData({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  await requireAdmin("/admin/test-data");
  const lane = await resolveTestLane(false);
  const query = await searchParams;
  if (lane !== "real") {
    return (
      <main className="px-4 py-8">
        <h1 className="font-display text-4xl font-semibold text-ink">Test data</h1>
        <p className="mt-4 text-base text-muted">A test admin cannot clean up or view the real-account lane.</p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_test_data_cleanup");
  const preview = (data ?? null) as Preview | null;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Test data</h1>
      <p className="mt-3 text-base text-muted">
        This is a dry run until you confirm. Retiring a test account hides it from feeds and admin totals. Payments, ledger lines, messages, and the audit log stay.
      </p>
      <p className="mt-4">
        <Link href="/admin" className="font-semibold text-brand">
          Back to the dashboard
        </Link>
      </p>
      {query.done === "1" ? (
        <p role="status" className="mt-4 rounded-2xl bg-brand-soft px-4 py-3 font-semibold text-brand-dark">
          Test accounts were retired. Financial records and the audit log were kept.
        </p>
      ) : null}
      {query.error === "confirm" ? (
        <p role="alert" className="mt-4 text-base text-danger">
          Type DELETE TEST DATA to confirm.
        </p>
      ) : null}
      {query.error === "save" || error || !preview ? (
        <p role="alert" className="mt-4 text-base text-danger">
          The test-data preview could not be loaded.
        </p>
      ) : (
        <>
          <h2 className="mt-8 text-xl font-semibold text-ink">Would change</h2>
          <ul className="mt-3 space-y-2 text-base">
            <li>{preview.profiles} test profiles would be retired</li>
            <li>{preview.jobs} test jobs would be retired</li>
            <li>{preview.notifications} alerts would be removed</li>
            <li>{preview.push_subscriptions} push subscriptions would be removed</li>
            <li>{preview.funnel_events} funnel events would be removed</li>
          </ul>
          <h2 className="mt-8 text-xl font-semibold text-ink">Kept</h2>
          <ul className="mt-3 space-y-2 text-base">
            <li>{preview.ledger_kept} ledger rows</li>
            <li>{preview.payments_kept} payment rows</li>
            <li>{preview.messages_kept} messages</li>
            <li>The audit log is not deleted</li>
          </ul>
          <form action={cleanupTestData} className="mt-8 grid gap-3">
            <label className="font-semibold" htmlFor="confirmation">
              Type DELETE TEST DATA to retire these accounts
              <input
                id="confirmation"
                name="confirmation"
                autoComplete="off"
                className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4"
              />
            </label>
            <button type="submit" className="min-h-12 rounded-full bg-ink px-5 font-semibold text-white">
              Retire test data
            </button>
          </form>
        </>
      )}
    </main>
  );
}
