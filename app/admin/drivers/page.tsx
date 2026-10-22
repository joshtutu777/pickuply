import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Drivers",
};

export default function AdminDriversPage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <DriversContent />
    </Suspense>
  );
}

async function DriversContent() {
  await requireAdmin("/admin/drivers");
  const supabase = await createClient();
  const { data: drivers, error } = await supabase
    .from("drivers")
    .select("profile_id, status, home_city, created_at")
    .order("created_at", { ascending: false });
  const ids = (drivers ?? []).map((driver) => driver.profile_id);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] };
  const names = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Drivers</h1>
      <Link href="/admin" className="mt-4 inline-flex min-h-12 items-center font-semibold text-brand">
        Back to requests
      </Link>
      {error ? (
        <p role="alert" className="mt-6 text-lg text-danger">
          We couldn&apos;t load drivers. Try again.
        </p>
      ) : drivers && drivers.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {drivers.map((driver) => (
            <li key={driver.profile_id}>
              <Link
                href={`/admin/drivers/${driver.profile_id}`}
                className="block rounded-3xl bg-paper-raised p-4 ring-1 ring-line"
              >
                <span className="block text-lg font-semibold text-ink">
                  {names.get(driver.profile_id) || "Applicant"}
                </span>
                <span className="mt-1 block text-base text-muted">
                  {driver.home_city || "No city"} · {driver.status.replaceAll("_", " ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-base leading-relaxed text-muted">No driver applications yet.</p>
      )}
    </main>
  );
}
