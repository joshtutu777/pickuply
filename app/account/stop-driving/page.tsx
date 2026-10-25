import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { stopDriving } from "@/app/account/stop-driving/actions";
import { BackLink } from "@/components/back-link";
import { LoadingMain } from "@/components/loading-main";
import { singleQuery } from "@/lib/auth/query";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Stop driving",
};

type StopDrivingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function StopDrivingPage({ searchParams }: StopDrivingPageProps) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <StopDrivingContent searchParams={searchParams} />
    </Suspense>
  );
}

async function StopDrivingContent({ searchParams }: StopDrivingPageProps) {
  const session = await requireSignedIn("/account/stop-driving");
  const params = await searchParams;
  const saved = singleQuery(params.saved);
  const error = singleQuery(params.error);
  const supabase = await createClient();
  const { data: driver } = await supabase
    .from("drivers")
    .select("driving_stopped_at")
    .eq("profile_id", session.userId)
    .maybeSingle();
  const stopped = saved === "stopped" || saved === "pending" || Boolean(driver?.driving_stopped_at);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href={session.role === "driver" ? "/driver/profile" : "/account/profile"} label="Profile" />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Account management</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Stop Driving</h1>
      <div className="mt-4 space-y-3 text-base text-ink">
        <p>This closes new driver offers. Your customer account and phone sign-in stay.</p>
        <p>Completed jobs and payment records stay. Driver-only documents are removed when nothing is still owed.</p>
        <p>An active job, a payout, a dispute, or money owed keeps those documents until that is finished. The customer account is not deleted.</p>
      </div>
      {saved === "stopped" ? (
        <p role="status" className="mt-6 text-base font-semibold text-ink">
          You stopped driving. New driver offers are closed.
        </p>
      ) : null}
      {saved === "pending" ? (
        <p role="status" className="mt-6 text-base font-semibold text-ink">
          New driver offers are closed. Driver documents stay until the open job, payout, dispute, or balance is finished.
        </p>
      ) : null}
      {stopped && saved !== "stopped" && saved !== "pending" ? (
        <p role="status" className="mt-6 text-base font-semibold text-ink">
          Driving is already stopped. Your customer account stays open.
        </p>
      ) : null}
      {error === "confirm" ? (
        <p role="alert" className="mt-4 text-base font-medium text-danger">
          Check the box and type STOP to continue.
        </p>
      ) : null}
      {error === "phone" ? (
        <p role="alert" className="mt-4 text-base font-medium text-danger">
          Confirm your phone again, then come back to this page.{" "}
          <Link href="/login?next=/account/stop-driving" className="font-semibold text-brand">
            Confirm phone
          </Link>
        </p>
      ) : null}
      {error === "driver" ? (
        <p role="alert" className="mt-4 text-base font-medium text-danger">
          This account is not set up to drive.
        </p>
      ) : null}
      {error === "1" ? (
        <p role="alert" className="mt-4 text-base font-medium text-danger">
          Driving could not be stopped. Try again.
        </p>
      ) : null}
      {driver && !stopped ? (
        <form action={stopDriving} className="mt-8 space-y-4">
          <label className="flex min-h-12 items-start gap-3 text-base text-ink">
            <input type="checkbox" name="confirm" className="mt-1" />
            I want to stop driving. My customer account stays.
          </label>
          <label className="block text-base font-semibold text-ink" htmlFor="phrase">
            Type STOP to confirm
            <input
              id="phrase"
              name="phrase"
              required
              autoComplete="off"
              className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4 text-base"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-6 text-base font-semibold text-white"
          >
            Stop Driving
          </button>
        </form>
      ) : null}
      {!driver ? (
        <p className="mt-6 text-base text-ink">This account is not set up to drive.</p>
      ) : null}
    </main>
  );
}
