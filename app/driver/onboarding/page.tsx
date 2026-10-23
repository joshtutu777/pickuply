import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
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
  const params = await searchParams;
  const submitted = params.submitted === "1";
  const supabase = await createClient();
  const [{ data: zones }, { data: driver }] = await Promise.all([
    supabase.from("zones").select("id, name").eq("active", true).order("name"),
    supabase
      .from("drivers")
      .select("status, review_note")
      .eq("profile_id", session.userId)
      .maybeSingle(),
  ]);

  const approved =
    session.role === "driver" ||
    driver?.status === "active" ||
    driver?.status === "approved_new" ||
    driver?.status === "paused";
  if (approved) redirect("/driver");

  const waiting = driver?.status === "pending_review" && (submitted || !driver.review_note);
  const closed = driver?.status === "removed";

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Driver</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        Drive with Pickuply
      </h1>
      {waiting ? (
        <div className="mt-6 space-y-4 text-base leading-relaxed text-ink">
          <p>Application submitted. We&apos;ll review it and contact you.</p>
          <p>Your application is in for review. We will look at your documents before you can take jobs.</p>
          <Link href="/driver" className="inline-flex min-h-12 items-center font-semibold text-brand">
            Get ready to drive
          </Link>
        </div>
      ) : null}
      {closed ? (
        <p className="mt-6 text-base leading-relaxed text-ink">
          This application was closed. You can submit it again below if something changed.
        </p>
      ) : null}
      {!waiting ? (
        <>
          <QuickApplyForm userId={session.userId} zones={zones ?? []} />
          {driver?.review_note ? (
            <p className="mt-4 text-base text-ink">Note from Pickuply: {driver.review_note}</p>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
