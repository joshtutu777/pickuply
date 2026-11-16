import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { OpenJob } from "@/components/driver/open-job";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { defaultFeeSettings } from "@/lib/fees";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Job details",
};

export default function DriverOpenJobPage({ params }: PageProps<"/driver/open/[id]">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <OpenJobPage params={params} />
    </Suspense>
  );
}

async function OpenJobPage({ params }: { params: PageProps<"/driver/open/[id]">["params"] }) {
  const session = await requireSignedIn("/driver");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: application }, { data: vehicle }, { data: feeRow }] = await Promise.all([
    supabase.from("drivers").select("status, is_online").eq("profile_id", session.userId).maybeSingle(),
    supabase
      .from("vehicles")
      .select("type")
      .eq("driver_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("platform_settings")
      .select("platform_bps, platform_min_cents, service_bps, service_fixed_cents")
      .eq("id", 1)
      .maybeSingle(),
  ]);
  if (!application || application.status === "removed") notFound();
  const fees = feeRow
    ? {
        platformBps: feeRow.platform_bps,
        platformMinCents: feeRow.platform_min_cents,
        serviceBps: feeRow.service_bps,
        serviceFixedCents: feeRow.service_fixed_cents,
      }
    : defaultFeeSettings;
  return (
    <OpenJob
      jobId={id}
      approved={application.status === "active" || application.status === "approved_new"}
      isOnline={Boolean(application.is_online)}
      userId={session.userId}
      vehicleType={vehicle?.type ?? null}
      fees={fees}
    />
  );
}
