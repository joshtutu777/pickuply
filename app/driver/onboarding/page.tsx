import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { QuickApplyForm } from "@/components/driver/quick-apply-form";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Drive with Pickuply",
};

export default function DriverOnboardingPage({
  searchParams,
}: PageProps<"/driver/onboarding">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <OnboardingContent searchParams={searchParams} />
    </Suspense>
  );
}

async function OnboardingContent({
  searchParams,
}: {
  searchParams: PageProps<"/driver/onboarding">["searchParams"];
}) {
  const session = await requireSignedIn("/driver/onboarding");
  await searchParams;
  const supabase = await createClient();
  const { data: driver } = await supabase
    .from("drivers")
    .select("profile_id")
    .eq("profile_id", session.userId)
    .maybeSingle();

  if (driver || session.role === "driver") redirect("/driver");

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href="/account" label="Account" />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Driver</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        Drive with Pickuply
      </h1>
      <QuickApplyForm userId={session.userId} defaultName={session.fullName ?? ""} />
    </main>
  );
}
