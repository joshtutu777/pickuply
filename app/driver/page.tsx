import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DriverHome } from "@/components/driver/driver-home";
import { ReadyChecklist } from "@/components/driver/ready-checklist";
import { ForbiddenAlert } from "@/components/forbidden-alert";
import { LoadingMain } from "@/components/loading-main";
import { singleQuery } from "@/lib/auth/query";
import { requireSignedIn } from "@/lib/auth/session";
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
          <Link href={`/driver/jobs/${job.id}`} className="font-semibold text-brand">
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
    const missing: string[] = [];
    if (!application || !["active", "approved_new"].includes(application.status)) {
      missing.push("Your driver account is not approved for jobs.");
    }
    if (!application?.license_expires || application.license_expires < today) {
      missing.push("Add an unexpired driver license before going Online.");
    }
    if (!application?.insurance_url || !application.insurance_expires || application.insurance_expires < today) {
      missing.push("Add unexpired insurance before going Online.");
    }
    if (!vehicle?.approved) missing.push("An approved vehicle is required before going Online.");
    if (application?.checklist_required && !application.agreement_signed_at) {
      missing.push("Sign the driver agreement before going Online.");
    }
    if (application?.checklist_required && !application.training_completed_at) {
      missing.push("Finish the short training before going Online.");
    }
    if (application?.checklist_required && (application.services ?? []).length < 1) {
      missing.push("Choose the services you offer before going Online.");
    }
    const approved = application && ["active", "approved_new"].includes(application.status);
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">Driver</p>
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
        {checklist}
        {forbidden ? <ForbiddenAlert /> : null}
        {approved ? <AssignedLinks userId={session.userId} /> : null}
        {approved ? <DriverHome isOnline={Boolean(application?.is_online)} missing={missing} /> : null}
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
