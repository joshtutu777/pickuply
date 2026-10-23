import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Driver profile",
};

export default function DriverProfilePage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <ProfileContent />
    </Suspense>
  );
}

async function ProfileContent() {
  const session = await requireSignedIn("/driver/profile");
  if (session.role !== "driver") notFound();
  const supabase = await createClient();
  const { data: driver } = await supabase
    .from("drivers")
    .select("home_city, status, is_online, checklist_required")
    .eq("profile_id", session.userId)
    .maybeSingle();

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Profile</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {session.fullName ?? "Driver profile"}
      </h1>
      <p className="mt-2 text-base text-muted">{driver?.home_city?.trim() || "Your area"}</p>
      {driver ? (
        <p className="mt-3 text-base text-ink">
          {driver.is_online ? "Online" : "Offline"} · {driver.status.replaceAll("_", " ")}
        </p>
      ) : null}
      <ul className="mt-6 grid gap-3">
        <li>
          <Link href="/driver/notifications" className="flex min-h-12 items-center rounded-3xl bg-paper-raised px-4 font-semibold text-ink ring-1 ring-line">
            Alerts
          </Link>
        </li>
        <li>
          <Link href="/driver/earnings" className="flex min-h-12 items-center rounded-3xl bg-paper-raised px-4 font-semibold text-ink ring-1 ring-line">
            Earnings and payouts
          </Link>
        </li>
        {driver?.checklist_required ? (
          <li>
            <Link href="/driver" className="flex min-h-12 items-center rounded-3xl bg-paper-raised px-4 font-semibold text-ink ring-1 ring-line">
              Get ready to drive
            </Link>
          </li>
        ) : null}
        <li>
          <Link href="/support" className="flex min-h-12 items-center rounded-3xl bg-paper-raised px-4 font-semibold text-ink ring-1 ring-line">
            Contact support
          </Link>
        </li>
      </ul>
      <div className="mt-6">
        <SignOutButton />
      </div>
    </main>
  );
}
