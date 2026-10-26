import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { DriverJobBoard } from "@/components/driver/job-board";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { groupDriverJobs } from "@/lib/driver/job-groups";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Jobs" };

export default function DriverJobsPage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <DriverJobs />
    </Suspense>
  );
}

async function DriverJobs() {
  const session = await requireSignedIn("/driver/jobs");
  const supabase = await createClient();
  const [{ data, error }, feed] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, service, status, payment_status, pickup_area, dropoff_area, driver_pay_cents, platform_fee_cents, test_retired_at")
      .eq("assigned_driver_id", session.userId)
      .order("updated_at", { ascending: false }),
    supabase.rpc("driver_job_feed"),
  ]);
  const groups = groupDriverJobs(
    (data ?? []).map((job) => ({
      id: job.id,
      service: job.service,
      status: job.status,
      paymentStatus: job.payment_status,
      pickupArea: job.pickup_area,
      dropoffArea: job.dropoff_area,
      driverPayCents: job.driver_pay_cents,
      platformFeeCents: job.platform_fee_cents,
      retired: job.test_retired_at != null,
    })),
  );
  const available = ((feed.data ?? []) as {
    id: string;
    service: string;
    pickup_area: string;
    dropoff_area: string | null;
    driver_pay_cents: number | null;
  }[]).map((job) => ({
    id: job.id,
    service: job.service,
    pickupArea: job.pickup_area,
    dropoffArea: job.dropoff_area,
    driverPayCents: job.driver_pay_cents,
  }));

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-3">
      <BackLink href="/driver" label="Driver home" />
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Jobs</h1>
      {error ? <p role="alert" className="mt-3 text-base text-danger">Your jobs could not be loaded.</p> : null}
      <DriverJobBoard groups={groups} available={available} feedError={Boolean(feed.error)} />
    </main>
  );
}
