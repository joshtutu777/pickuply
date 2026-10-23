import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DriverHome } from "@/components/driver/driver-home";
import { ReadyChecklist } from "@/components/driver/ready-checklist";
import { ForbiddenAlert } from "@/components/forbidden-alert";
import { LoadingMain } from "@/components/loading-main";
import { singleQuery } from "@/lib/auth/query";
import { requireSignedIn } from "@/lib/auth/session";
import { formatCents } from "@/lib/money";
import { onlineGaps } from "@/lib/driver/online-gaps";
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

  const supabase = await createClient();
  const { data: application } = await supabase
    .from("drivers")
    .select(
      "status, is_online, license_expires, insurance_expires, insurance_url, checklist_required, agreement_signed_at, training_completed_at, services, kit_saved_at",
    )
    .eq("profile_id", session.userId)
    .maybeSingle();
  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("approved, make, photo_url")
    .eq("driver_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: payout } = await supabase
    .from("driver_connect_accounts")
    .select("details_submitted")
    .eq("driver_id", session.userId)
    .maybeSingle();

  const checklist =
    application?.checklist_required ? (
      <ReadyChecklist
        items={[
          {
            id: "insurance",
            label: "Insurance and expiry",
            href: "/driver/ready/insurance",
            done: Boolean(application.insurance_url && application.insurance_expires),
          },
          {
            id: "vehicle",
            label: "Vehicle details and photo",
            href: "/driver/ready/vehicle",
            done: Boolean(vehicle?.make && vehicle.photo_url),
          },
          {
            id: "equipment",
            label: "Equipment and helper",
            href: "/driver/ready/equipment",
            done: Boolean(application.kit_saved_at),
          },
          {
            id: "services",
            label: "Services offered",
            href: "/driver/ready/services",
            done: (application.services ?? []).length > 0,
          },
          {
            id: "agreement",
            label: "Driver agreement",
            href: "/driver/ready/agreement",
            done: Boolean(application.agreement_signed_at),
          },
          {
            id: "training",
            label: "Training",
            href: "/driver/ready/training",
            done: Boolean(application.training_completed_at),
          },
          {
            id: "payout",
            label: "Stripe payout setup",
            href: "/driver/earnings",
            done: Boolean(payout?.details_submitted),
          },
        ]}
      />
    ) : null;

  if (session.role === "driver" || application) {
    const today = new Date().toISOString().slice(0, 10);
    const gaps = onlineGaps({
      status: application?.status ?? null,
      licenseExpires: application?.license_expires ?? null,
      insuranceUrl: application?.insurance_url ?? null,
      insuranceExpires: application?.insurance_expires ?? null,
      vehicleApproved: Boolean(vehicle?.approved),
      checklistRequired: Boolean(application?.checklist_required),
      agreementSigned: Boolean(application?.agreement_signed_at),
      trainingDone: Boolean(application?.training_completed_at),
      serviceCount: application?.services?.length ?? 0,
      today,
    });
    const approved = application && ["active", "approved_new"].includes(application.status);
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
          gaps={gaps}
          userId={session.userId}
          showFeed={Boolean(approved)}
        />
        <p className="mt-6 text-sm font-semibold tracking-wide text-brand uppercase">Driver</p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Driver home</h1>
        <p className="mt-3">
          <Link href="/driver/notifications" className="inline-flex min-h-12 items-center font-semibold text-brand">
            Alerts
          </Link>
        </p>
        <p>
          <Link href="/driver/earnings" className="inline-flex min-h-12 items-center font-semibold text-brand">
            Set up payouts
          </Link>
        </p>
        {application?.status === "pending_review" ? (
          <p className="mt-4 text-base leading-relaxed text-ink">
            Application submitted. We&apos;ll review it and contact you.
          </p>
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
