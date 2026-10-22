import Link from "next/link";
import { Suspense } from "react";
import { refreshPayoutSetup, startPayoutSetup } from "@/app/driver/connect/actions";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { payoutSetupLabel, requirementLabels } from "@/lib/payments/requirements";
import { refreshConnectAccount } from "@/lib/payments/connect";
import { createClient } from "@/lib/supabase/server";

export default function EarningsPage({ searchParams }: PageProps<"/driver/earnings">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Earnings searchParams={searchParams} />
    </Suspense>
  );
}

async function Earnings({ searchParams }: { searchParams: PageProps<"/driver/earnings">["searchParams"] }) {
  const session = await requireSignedIn("/driver/earnings");
  if (session.role !== "driver") {
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
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

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Driver</p>
      <h1 className="mt-3 font-display text-4xl font-semibold text-ink">Earnings</h1>
      <p className="mt-3 text-base text-muted">
        Completed jobs show pending, held, and transferred earnings here after payment is captured.
      </p>
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
      <p className="mt-4">
        <Link href="/driver" className="inline-flex min-h-12 items-center font-semibold text-brand">
          Driver home
        </Link>
      </p>
    </main>
  );
}
