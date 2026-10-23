import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { DriverHome } from "@/components/driver/driver-home";
import { ReadyChecklist } from "@/components/driver/ready-checklist";
import { ForbiddenAlert } from "@/components/forbidden-alert";
import { LoadingMain } from "@/components/loading-main";
import { singleQuery } from "@/lib/auth/query";
import { requireSignedIn } from "@/lib/auth/session";
import { formatCents } from "@/lib/money";
import { applicationStatusCopy } from "@/lib/driver/application-status";
import { checklistItems, checklistProgress } from "@/lib/driver/checklist";
import type { CoverageDraft } from "@/lib/driver/coverage";
import { ledgerBuckets } from "@/lib/payments/ledger-summary";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Driver home",
};

export default function DriverPage({ searchParams }: PageProps<"/driver">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <DriverContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AssignedLinks({ userId }: { userId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("id, service, status")
    .eq("assigned_driver_id", userId)
    .order("updated_at", { ascending: false });
  if (!data || data.length === 0) return null;
  return (
    <ul className="mt-4 space-y-2">
      {data.map((job) => (
        <li key={job.id}>
          <Link
            href={`/driver/jobs/${job.id}`}
            className="block min-h-12 rounded-3xl bg-paper-raised p-4 font-semibold text-brand ring-1 ring-line"
          >
            {job.service} · {job.status}
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function DriverContent({
  searchParams,
}: {
  searchParams: PageProps<"/driver">["searchParams"];
}) {
  const session = await requireSignedIn("/driver");
  const params = await searchParams;
  const forbidden = singleQuery(params.error) === "forbidden";
  const saved = singleQuery(params.saved);

  const supabase = await createClient();
  const { data: application } = await supabase
    .from("drivers")
    .select(
      "status, review_note, is_online, first_online_at, license_url, license_expires, insurance_expires, insurance_url, checklist_required, agreement_signed_at, training_completed_at, services, kit_saved_at",
    )
    .eq("profile_id", session.userId)
    .maybeSingle();
  const { data: coverageRow } = await supabase
    .from("driver_feed_filters")
    .select("cities, zips, radius_miles, radius_zip, show_all, services, vehicle_fit")
    .eq("profile_id", session.userId)
    .maybeSingle();
  const coverage: CoverageDraft = coverageRow
    ? {
        cities: coverageRow.cities ?? [],
        zips: coverageRow.zips ?? [],
        radius: coverageRow.radius_miles,
        radiusZip: coverageRow.radius_zip ?? "",
      }
    : { cities: [], zips: [], radius: null, radiusZip: "" };
  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("type, approved, make, photo_url")
    .eq("driver_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: notes } = application
    ? await supabase.from("driver_item_reviews").select("item, note").eq("driver_id", session.userId)
    : { data: null };
  const noteMap = Object.fromEntries((notes ?? []).map((row) => [row.item, row.note]));
  const items = application
    ? checklistItems({
        vehicleType: vehicle?.type ?? null,
        insuranceUrl: application.insurance_url ?? null,
        trainingDone: Boolean(application.training_completed_at),
        notes: noteMap,
      })
    : [];
  const statusCopy = applicationStatusCopy(application?.status ?? null);
  const approved = application && ["active", "approved_new"].includes(application.status);
  const statusLine =
    application?.status === "pending_review" || application?.status === "applied"
      ? "⏳ Application in review"
      : approved
        ? "✅ Approved"
        : null;
  const progress = checklistProgress(items);
  const checklist =
    application && application.status !== "removed" ? (
      <ReadyChecklist
        items={items}
        statusLine={statusLine}
        collapsed={Boolean(approved && progress.done === progress.total)}
      />
    ) : null;

  if (session.role === "driver" || application) {
    let earnings: ReturnType<typeof ledgerBuckets> | null = null;
    if (approved) {
      const { data: ledger } = await supabase
        .from("ledger_entries")
        .select("status, amount_cents")
        .eq("driver_id", session.userId);
      if (ledger) earnings = ledgerBuckets(ledger);
    }
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
        <DriverHome
          isOnline={Boolean(application?.is_online)}
          userId={session.userId}
          showFeed={Boolean(application) && application?.status !== "removed"}
          approved={Boolean(approved)}
          vehicleType={vehicle?.type ?? null}
          everOnline={Boolean(application?.first_online_at)}
          promptDismissed={(await cookies()).get("pickuply.online-prompt")?.value === "dismissed"}
          coverage={coverage}
          showAllJobs={Boolean(coverageRow?.show_all)}
          feedServices={(coverageRow?.services ?? []).join(", ")}
          vehicleFit={Boolean(coverageRow?.vehicle_fit)}
        />
        <p className="mt-6 text-sm font-semibold tracking-wide text-brand uppercase">Driver</p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Driver home</h1>
        {saved ? (
          <p role="status" className="mt-3 text-base font-semibold text-ink">
            Saved
          </p>
        ) : null}
        {statusCopy && application?.status !== "pending_review" && application?.status !== "applied" ? (
          <section className="mt-4" aria-label="Application status">
            <h2 className="font-display text-2xl font-semibold text-ink">{statusCopy.title}</h2>
            <p className="mt-2 text-base leading-relaxed text-ink">{statusCopy.body}</p>
            {application?.review_note ? (
              <p className="mt-2 text-base text-ink">Note from Pickuply: {application.review_note}</p>
            ) : null}
            {application?.status === "removed" ? (
              <Link href="/support" className="mt-3 inline-flex min-h-12 items-center font-semibold text-brand">
                Contact support
              </Link>
            ) : null}
          </section>
        ) : null}
        {session.role === "driver" ? (
          <p className="mt-3">
            <Link href="/driver/notifications" className="inline-flex min-h-12 items-center font-semibold text-brand">
              Alerts
            </Link>
          </p>
        ) : (
          <p className="mt-3 text-base text-muted">Payout setup opens after you are approved.</p>
        )}
        {approved && session.role === "driver" ? (
          <section className="mt-4 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
            <h2 className="font-display text-2xl font-semibold text-ink">Set up payouts to get paid</h2>
            <p className="mt-2 text-base text-ink">Earnings stay held until payouts are set up. This does not block going Online.</p>
            <Link href="/driver/earnings" className="mt-3 inline-flex min-h-12 items-center font-semibold text-brand">
              Set up payouts
            </Link>
          </section>
        ) : null}
        {application?.status === "approved_new" ? (
          <p className="mt-3 text-base text-muted">
            New drivers see jobs an admin invites them to. You will not see the full public feed yet.
          </p>
        ) : null}
        {earnings ? (
          <section className="mt-6 grid grid-cols-3 gap-2" aria-label="Earnings">
            <div className="rounded-3xl bg-paper-raised p-3 ring-1 ring-line">
              <p className="text-xs font-semibold text-muted">Completed</p>
              <p className="mt-1 font-semibold text-ink">{formatCents(earnings.completedCents)}</p>
            </div>
            <div className="rounded-3xl bg-paper-raised p-3 ring-1 ring-line">
              <p className="text-xs font-semibold text-muted">Pending</p>
              <p className="mt-1 font-semibold text-ink">{formatCents(earnings.pendingCents)}</p>
            </div>
            <div className="rounded-3xl bg-paper-raised p-3 ring-1 ring-line">
              <p className="text-xs font-semibold text-muted">Transferred</p>
              <p className="mt-1 font-semibold text-ink">{formatCents(earnings.transferredCents)}</p>
            </div>
          </section>
        ) : null}
        {checklist}
        {forbidden ? <ForbiddenAlert /> : null}
        {approved ? <AssignedLinks userId={session.userId} /> : null}
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-14">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Driver</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        Become a driver
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-muted">
        Have a truck or van? You can haul items for people nearby. Submit an application and we
        will review your documents.
      </p>
      {forbidden ? <ForbiddenAlert /> : null}
      <Link
        href="/driver/onboarding"
        className="mt-8 inline-flex min-h-12 items-center justify-center self-start rounded-full bg-brand px-6 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
      >
        Start driver signup
      </Link>
    </main>
  );
}
