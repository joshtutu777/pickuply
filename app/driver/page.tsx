import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DriverHome } from "@/components/driver/driver-home";
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

  if (session.role === "driver") {
    const supabase = await createClient();
    const { data: driver } = await supabase
      .from("drivers")
      .select("status, is_online, license_expires, insurance_expires, insurance_url")
      .eq("profile_id", session.userId)
      .maybeSingle();
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("approved")
      .eq("driver_id", session.userId)
      .eq("approved", true)
      .limit(1)
      .maybeSingle();
    const missing: string[] = [];
    if (!driver || !["active", "approved_new"].includes(driver.status)) {
      missing.push("Your driver account is not approved for jobs.");
    }
    if (!driver?.license_expires || driver.license_expires < new Date().toISOString().slice(0, 10)) {
      missing.push("Add an unexpired driver license before going Online.");
    }
    if (!driver?.insurance_url || !driver.insurance_expires || driver.insurance_expires < new Date().toISOString().slice(0, 10)) {
      missing.push("Add unexpired insurance before going Online.");
    }
    if (!vehicle) missing.push("An approved vehicle is required before going Online.");
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">Driver</p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Driver home</h1>
        <p className="mt-3">
          <Link href="/driver/notifications" className="inline-flex min-h-12 items-center font-semibold text-brand">
            Alerts
          </Link>
        </p>
        {driver?.status === "approved_new" ? (
          <p className="mt-3 text-base text-muted">
            New drivers see jobs an admin invites them to. You will not see the full public feed yet.
          </p>
        ) : null}
        {forbidden ? <ForbiddenAlert /> : null}
        <AssignedLinks userId={session.userId} />
        <DriverHome isOnline={Boolean(driver?.is_online)} missing={missing} />
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
