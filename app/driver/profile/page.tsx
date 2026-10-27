import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { AreaMap } from "@/components/maps/area-map";
import { PlaceEditor } from "@/components/maps/place-editor";
import { ProfileEmailForm } from "@/components/profile/email-form";
import { ContactPreferences } from "@/components/profile/contact-preferences";
import { DeviceAlertPreferences } from "@/components/profile/device-alert-preferences";
import { ProfileMenu } from "@/components/profile/profile-menu";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Driver profile",
};

export default function DriverProfilePage({ searchParams }: PageProps<"/driver/profile">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <ProfileContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ProfileContent({ searchParams }: { searchParams: PageProps<"/driver/profile">["searchParams"] }) {
  const session = await requireSignedIn("/driver/profile");
  if (session.role !== "driver") notFound();
  const query = await searchParams;
  const supabase = await createClient();
  const [{ data: profile }, { data: driver }, { data: place }, { data: prefs }] = await Promise.all([
    supabase.from("profiles").select("phone, email").eq("id", session.userId).maybeSingle(),
    supabase
      .from("drivers")
      .select("home_city, home_zip, status, is_online")
      .eq("profile_id", session.userId)
      .maybeSingle(),
    supabase.from("driver_places").select("line1, unit, city, zip, notes").eq("profile_id", session.userId).maybeSingle(),
    supabase
      .from("notification_preferences")
      .select("push_enabled, email_enabled, promotional_sms")
      .maybeSingle(),
  ]);
  const centroid = driver?.home_zip
    ? (await supabase.from("ga_zip_centroids").select("lat, lng, city, zip").eq("zip", driver.home_zip).maybeSingle()).data
    : null;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href="/driver" label="Driver home" />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Profile</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {session.fullName ?? "Driver profile"}
      </h1>
      {driver ? (
        <p className="mt-3 text-base text-ink">
          {driver.is_online ? "Online" : "Offline"} · {driver.status.replaceAll("_", " ")}
        </p>
      ) : null}
      {centroid ? (
        <div className="mt-6">
          <AreaMap
            caption={`${centroid.city} ${centroid.zip}`}
            circles={[{ lat: centroid.lat, lng: centroid.lng, label: `${centroid.city} ${centroid.zip}` }]}
          />
        </div>
      ) : (
        <p className="mt-6 text-base text-muted">Home area: —</p>
      )}
      <PlaceEditor
        kind="driver"
        initial={
          place
            ? {
                line1: place.line1,
                unit: place.unit ?? "",
                city: place.city,
                zip: place.zip,
                lat: null,
                lng: null,
                verified: false,
                notes: place.notes ?? "",
              }
            : undefined
        }
      />
      <ProfileEmailForm email={profile?.email ?? null} />
      <DeviceAlertPreferences publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} showJobAlerts />
      <ContactPreferences
        phone={profile?.phone ?? null}
        email={profile?.email ?? null}
        returnTo="/driver/profile"
        pushEnabled={prefs?.push_enabled ?? true}
        emailEnabled={prefs?.email_enabled ?? true}
        promotional={Boolean(prefs?.promotional_sms)}
        saved={query.saved === "1"}
        error={query.error === "save"}
      />
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
