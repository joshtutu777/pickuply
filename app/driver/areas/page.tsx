import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { AreasForm } from "@/components/driver/areas-form";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import type { CoverageDraft } from "@/lib/driver/coverage";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Areas I cover",
};

export default function AreasPage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <AreasContent />
    </Suspense>
  );
}

async function AreasContent() {
  const session = await requireSignedIn("/driver/areas");
  const supabase = await createClient();
  const { data } = await supabase
    .from("driver_feed_filters")
    .select("cities, zips, radius_miles, radius_zip")
    .eq("profile_id", session.userId)
    .maybeSingle();
  const coverage: CoverageDraft = {
    cities: data?.cities ?? [],
    zips: data?.zips ?? [],
    radius: data?.radius_miles ?? 25,
    radiusZip: data?.radius_zip ?? "",
  };
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href="/driver/profile" label="Profile" />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Profile</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Areas I cover</h1>
      <div className="mt-6">
        <AreasForm coverage={coverage} />
      </div>
    </main>
  );
}
