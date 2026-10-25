import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PlaceEditor } from "@/components/maps/place-editor";
import { ProfileEmailForm } from "@/components/profile/email-form";
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
  const [{ data: profile }, { data: driver }, { data: places }] = await Promise.all([
    supabase.from("profiles").select("phone, email").eq("id", session.userId).maybeSingle(),
    supabase.from("drivers").select("profile_id").eq("profile_id", session.userId).maybeSingle(),
    supabase.from("customer_places").select("id, label, city, zip").eq("customer_id", session.userId),
  ]);
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href="/account" label="Account" />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Profile</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {session.fullName ?? "Your profile"}
      </h1>
      <section className="mt-6">
        <h2 className="text-lg font-semibold text-ink">Saved addresses</h2>
        {(places ?? []).length === 0 ? <p className="mt-2 text-base text-muted">No saved addresses yet.</p> : null}
        <ul className="mt-2 space-y-2">
          {(places ?? []).map((place) => (
            <li key={place.id} className="text-base text-ink">
              {place.label}: {place.city} {place.zip}
            </li>
          ))}
        </ul>
        <PlaceEditor kind="customer" />
      </section>
      <ProfileEmailForm email={profile?.email ?? null} />
      <ProfileMenu
        phone={profile?.phone ?? null}
        role={session.role}
        hasDriver={Boolean(driver) || session.role === "driver"}
        surface="customer"
      />
    </main>
  );
}
