import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { ProfileMenu } from "@/components/profile/profile-menu";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Profile",
};

export default function ProfilePage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <ProfileContent />
    </Suspense>
  );
}

async function ProfileContent() {
  const session = await requireSignedIn("/account/profile");
  const supabase = await createClient();
  const [{ data: profile }, { data: driver }] = await Promise.all([
    supabase.from("profiles").select("phone").eq("id", session.userId).maybeSingle(),
    supabase.from("drivers").select("profile_id").eq("profile_id", session.userId).maybeSingle(),
  ]);
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href="/account" label="Account" />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Profile</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {session.fullName ?? "Your profile"}
      </h1>
      <ProfileMenu
        phone={profile?.phone ?? null}
        role={session.role}
        hasDriver={Boolean(driver) || session.role === "driver"}
        surface="customer"
      />
    </main>
  );
}
