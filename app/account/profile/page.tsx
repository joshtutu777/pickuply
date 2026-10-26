import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PlaceEditor } from "@/components/maps/place-editor";
import { ProfileEmailForm } from "@/components/profile/email-form";
import { ContactPreferences } from "@/components/profile/contact-preferences";
import { DeviceAlertPreferences } from "@/components/profile/device-alert-preferences";
import { ProfileMenu } from "@/components/profile/profile-menu";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Profile",
};

export default function ProfilePage({ searchParams }: PageProps<"/account/profile">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <ProfileContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ProfileContent({ searchParams }: { searchParams: PageProps<"/account/profile">["searchParams"] }) {
  const session = await requireSignedIn("/account/profile");
  const query = await searchParams;
  const supabase = await createClient();
  const [{ data: profile }, { data: driver }, { data: places }, { data: prefs }] = await Promise.all([
    supabase.from("profiles").select("phone, email").eq("id", session.userId).maybeSingle(),
    supabase.from("drivers").select("profile_id").eq("profile_id", session.userId).maybeSingle(),
    supabase.from("customer_places").select("id, label, city, zip").eq("customer_id", session.userId),
    supabase.from("notification_preferences").select("push_enabled, email_enabled, promotional_sms").maybeSingle(),
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
      <DeviceAlertPreferences publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} showJobAlerts={false} />
      <ContactPreferences
        phone={profile?.phone ?? null}
        email={profile?.email ?? null}
        returnTo="/account/profile"
        pushEnabled={prefs?.push_enabled ?? true}
        emailEnabled={prefs?.email_enabled ?? true}
        promotional={Boolean(prefs?.promotional_sms)}
        saved={query.saved === "1"}
        error={query.error === "save"}
      />
      <ProfileMenu
        phone={profile?.phone ?? null}
        role={session.role}
        hasDriver={Boolean(driver) || session.role === "driver"}
        surface="customer"
      />
    </main>
  );
}
