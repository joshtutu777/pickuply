import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProfileMenu } from "@/components/profile/profile-menu";
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
  const [{ data: profile }, { data: driver }] = await Promise.all([
    supabase.from("profiles").select("phone").eq("id", session.userId).maybeSingle(),
    supabase
      .from("drivers")
      .select("home_city, status, is_online")
      .eq("profile_id", session.userId)
      .maybeSingle(),
  ]);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Profile</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {session.fullName ?? "Driver profile"}
      </h1>
      {driver ? (
        <p className="mt-3 text-base text-ink">
          {driver.is_online ? "Online" : "Offline"} · {driver.status.replaceAll("_", " ")}
        </p>
      ) : null}
      <ProfileMenu
        phone={profile?.phone ?? null}
        role={session.role}
        hasDriver
        area={driver?.home_city?.trim() || null}
        surface="driver"
      />
    </main>
  );
}
